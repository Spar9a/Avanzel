// Builds, signs and checks a release of Avanzel for Mac, and with --publish puts it on GitHub as v<version>, where the
// app's updater finds it. RELEASING.md says what it does and why, in plain words.
//
//   node scripts/release.mjs              signed with the Developer ID in the keychain, with the hardened runtime, and
//                                         notarized and stapled when the notary profile avanzel-notary works
//   node scripts/release.mjs --local      a dry run signed with Avanzel Local (scripts/signing.mjs), for a Mac without
//                                         the Developer ID. Apple can't notarize it, and it is never published
//   add --publish [--notes <file>]        then the GitHub release v<version>, with a token in GH_TOKEN: the DMG, the ZIP
//                                         and its blockmap, latest-mac.yml and SHA256SUMS.txt
//   add --allow-dirty                     build with uncommitted changes, to try the script out; never with --publish
//
// The build lands in apps/mac/release/<version> (or <version>-local). It never creates, moves or pushes a git ref:
// push main and the tag v<version> before --publish.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAME as LOCAL_NAME, localIdentity, unlock } from "./signing.mjs";

const mac = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(mac, "..", "..");
const OWNER = "Spar9a";
const REPO = "Avanzel";
const PROFILE = "avanzel-notary";
const BUNDLE_ID = "app.avanzel.mac";
// A self-made identity has no Team ID, and library validation then refuses to load Electron's own framework. Only
// --local builds turn it off; in a Developer ID build every library carries the same Team ID.
const LIBRARY_VALIDATION = "com.apple.security.cs.disable-library-validation";

const HELPERS = [
  { name: "avanzel-calltap", built: "native/calltap/build/avanzel-calltap", inApp: "Contents/Resources/calltap/avanzel-calltap", identifier: "app.avanzel.mac.calltap", entitlements: "build/entitlements.calltap.plist" },
  { name: "avanzel-cursor", built: "native/cursor/build/avanzel-cursor", inApp: "Contents/Resources/cursor/avanzel-cursor", identifier: "app.avanzel.mac.cursor", entitlements: null },
];

// Electron's fuses as the two electron-builder configs set them, by their place in the fuse wire (@electron/fuses).
const FUSE_SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
const FUSES = [
  { name: "RunAsNode", index: 0, on: true }, // for the write guard, for now (electron-builder.yml)
  { name: "EnableNodeOptionsEnvironmentVariable", index: 2, on: false },
  { name: "EnableNodeCliInspectArguments", index: 3, on: false },
  { name: "EnableEmbeddedAsarIntegrityValidation", index: 4, on: true },
  { name: "OnlyLoadAppFromAsar", index: 5, on: true },
];

// ---- What was asked

const USAGE = "Use: node scripts/release.mjs [--local] [--publish [--notes <file>]] [--allow-dirty]";
const options = { local: false, publish: false, notes: null, allowDirty: false };
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--local") options.local = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--allow-dirty") options.allowDirty = true;
    else if (arg === "--notes" && args[i + 1]) options.notes = path.resolve(args[++i]);
    else stop(`${arg === "--notes" ? "--notes needs a file." : `I don't know ${arg}.`}\n${USAGE}`);
  }
}
if (options.publish && options.local) stop("A --local build is a dry run: Apple can't notarize it, so it isn't published.");
if (options.publish && options.allowDirty) stop("A published release is exactly a commit, so --publish doesn't go with --allow-dirty.");
if (options.notes && !options.publish) stop("--notes is the text of the GitHub release, so it goes with --publish.");
if (options.notes && !existsSync(options.notes)) stop(`There's no file ${options.notes}.`);

// The token is read once here, and no command this script runs gets it.
const token = process.env.GH_TOKEN ?? "";
const childEnv = { ...process.env };
for (const key of ["ELECTRON_RUN_AS_NODE", "GH_TOKEN", "GITHUB_TOKEN"]) delete childEnv[key];

// The temporary folders this run makes, the copy of the app sent to Apple among them: gone when it ends, however it ends.
const scratch = [];
function scratchDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ---- Output and commands

function stop(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

let stepCount = 0;
const step = (title) => console.log(`\n${++stepCount}. ${title}`);
const note = (message) => console.log(message.replace(/^/gm, "   "));
const megabytes = (file) => `${(statSync(file).size / 1e6).toFixed(1)} MB`;

/** Runs a command where its output shows; stops the release when it fails. */
function run(command, args, { env = childEnv } = {}) {
  const result = spawnSync(command, args, { cwd: mac, env, stdio: "inherit" });
  if (result.error) stop(`${command} didn't start: ${result.error.message}`);
  if (result.status !== 0) stop(`${command} failed (exit code ${result.status}): ${command} ${args.join(" ")}`);
}

/** Runs a command and keeps what it says. */
function capture(command, args, { env = childEnv } = {}) {
  const result = spawnSync(command, args, { cwd: mac, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) stop(`${command} didn't start: ${result.error.message}`);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status, stdout, stderr, all: `${stdout}${stderr}`.trim() };
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs a command for a check: throws with what it said when it fails. */
function mustRun(command, args) {
  const result = capture(command, args);
  must(result.status === 0, result.all || `${command} failed`);
  return result.all;
}

// ---- Signing

/** Avanzel Local, for a dry run. */
function localSigner() {
  const hash = localIdentity();
  if (!hash) stop(`"${LOCAL_NAME}" isn't on this Mac. Make it once with: npm run signing:setup -w @avanzel/mac`);
  unlock();
  return { hash, name: LOCAL_NAME, team: null };
}

/** The one Developer ID Application identity in the keychain, or the one AVANZEL_RELEASE_IDENTITY names. */
function developerIdSigner() {
  const listed = capture("security", ["find-identity", "-v", "-p", "codesigning"]).stdout;
  const found = new Map();
  for (const [, hash, name] of listed.matchAll(/([0-9A-F]{40}) "(Developer ID Application: [^"]+)"/g)) found.set(hash, name);
  const wanted = process.env.AVANZEL_RELEASE_IDENTITY;
  const matches = [...found].filter(([hash, name]) => !wanted || hash === wanted.toUpperCase() || name === wanted);
  if (!matches.length) {
    stop(
      wanted
        ? `No Developer ID Application identity in the keychain matches AVANZEL_RELEASE_IDENTITY (${wanted}).`
        : "There's no Developer ID Application identity in the keychain. RELEASING.md says how to get one; until then, release with --local.",
    );
  }
  if (matches.length > 1) {
    stop(`The keychain has several Developer ID Application identities. Set AVANZEL_RELEASE_IDENTITY to the SHA-1 of the one to use:\n${matches.map(([hash, name]) => `  ${hash}  ${name}`).join("\n")}`);
  }
  const [hash, name] = matches[0];
  return { hash, name, team: /\(([A-Z0-9]{10})\)$/.exec(name)?.[1] ?? null };
}

/** The entitlement names in a plist file. */
function plistKeys(file) {
  const result = capture("plutil", ["-convert", "json", "-o", "-", file]);
  if (result.status !== 0) stop(`${file} isn't a property list: ${result.all}`);
  return Object.keys(JSON.parse(result.stdout)).sort();
}

/** What codesign says about a signature. */
function signature(file) {
  const shown = capture("codesign", ["-dvvv", file]);
  must(shown.status === 0, shown.all);
  const text = shown.all;
  const entitlements = capture("codesign", ["-d", "--entitlements", "-", "--xml", file]).stdout;
  const requirement = capture("codesign", ["-d", "-r-", file]).all.split("\n").find((line) => line.startsWith("designated =>")) ?? "";
  return {
    identifier: /^Identifier=(.*)$/m.exec(text)?.[1],
    authority: /^Authority=(.*)$/m.exec(text)?.[1],
    team: /^TeamIdentifier=(.*)$/m.exec(text)?.[1],
    runtime: /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(text),
    timestamp: /^Timestamp=/m.test(text),
    cdhash: /^CDHash=(.*)$/m.exec(text)?.[1],
    entitlements: [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort(),
    requirement,
  };
}

/** The states of Electron's fuses, read from the fuse wire in Electron's framework. */
function fuseStates(app) {
  const binary = readFileSync(path.join(app, "Contents/Frameworks/Electron Framework.framework/Electron Framework"));
  const at = binary.indexOf(FUSE_SENTINEL);
  must(at >= 0, "Electron's framework has no fuse wire");
  const start = at + FUSE_SENTINEL.length;
  must(binary[start] === 1, `the fuse wire is version ${binary[start]}, not 1`);
  const length = binary[start + 1];
  return Array.from({ length }, (_, i) => binary[start + 2 + i]);
}

// ---- Notarizing

/** Sends a file to Apple's notary service and waits for its answer; stops the release unless Apple accepts it. */
function notarize(file, what) {
  note(`Sending ${what} to Apple. This usually takes a few minutes.`);
  const result = capture("xcrun", ["notarytool", "submit", file, "--keychain-profile", PROFILE, "--wait", "--output-format", "json"]);
  let answer = {};
  try {
    answer = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}");
  } catch {
    // answered with something else: shown below
  }
  if (result.status !== 0 || answer.status !== "Accepted") {
    if (answer.id) run("xcrun", ["notarytool", "log", answer.id, "--keychain-profile", PROFILE]);
    stop(`Apple didn't accept ${what}: ${answer.status ?? result.all}`);
  }
  note(`Apple accepted ${what} (submission ${answer.id}).`);
}

// ---- GitHub

const githubHeaders = () => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "avanzel-release",
});

async function github(method, route, body, { missingOk = false } = {}) {
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers: { ...githubHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (missingOk && response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${method} ${route}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** Uploads one file to a release, streamed from disk. */
function upload(release, file) {
  const name = path.basename(file);
  const url = new URL(release.upload_url.replace(/\{[^}]*\}$/, ""));
  url.searchParams.set("name", name);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/octet-stream", "Content-Length": String(statSync(file).size) },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === 201) resolve(JSON.parse(text));
        else reject(new Error(`Uploading ${name} failed: GitHub answered ${res.statusCode}: ${text.slice(0, 500)}`));
      });
    });
    req.on("error", reject);
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.pipe(req);
  });
}

/** A release asset's bytes, through the API, so it works for a draft too. */
async function download(asset) {
  let response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`, {
    headers: { ...githubHeaders(), Accept: "application/octet-stream" },
    redirect: "manual",
  });
  // GitHub sends the bytes from a signed address of their own; the token doesn't go there.
  if (response.status >= 300 && response.status < 400) response = await fetch(response.headers.get("location"));
  if (!response.ok) throw new Error(`Downloading ${asset.name} back failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Before building: the tag is on GitHub at this very commit, and nothing is released under it yet. */
async function checkPublishable(tag, head) {
  if (!token) stop("--publish needs a GitHub token in GH_TOKEN, one that may write this repo's releases.");
  const ref = await github("GET", `/repos/${OWNER}/${REPO}/git/ref/tags/${tag}`, null, { missingOk: true });
  if (!ref) stop(`GitHub has no tag ${tag} in ${OWNER}/${REPO}. Push main and the tag first: this script never makes or pushes one.`);
  let object = ref.object;
  if (object.type === "tag") object = (await github("GET", `/repos/${OWNER}/${REPO}/git/tags/${object.sha}`)).object;
  if (object.sha !== head) stop(`The tag ${tag} on GitHub is ${object.sha.slice(0, 7)}, but this checkout is ${head.slice(0, 7)}. Build from the tagged commit.`);
  const released = await github("GET", `/repos/${OWNER}/${REPO}/releases/tags/${tag}`, null, { missingOk: true });
  if (released) stop(`${tag} is released already: ${released.html_url}`);
  note(`GitHub has the tag ${tag} at this commit, and no release of it yet.`);
}

function defaultNotes(version, dmg) {
  return [
    `Avanzel ${version} for Macs with Apple silicon.`,
    "",
    `To install it, download ${dmg}, open it, and drag Avanzel to Applications.`,
    "",
    "SHA256SUMS.txt lists the SHA-256 sum of each file.",
    "",
  ].join("\n");
}

async function publish({ tag, version, files, yml, notes }) {
  step(`Publishing ${tag} on GitHub`);
  const name = `Avanzel ${version}`;
  const releases = await github("GET", `/repos/${OWNER}/${REPO}/releases?per_page=100`);
  let release = releases.find((entry) => entry.tag_name === tag);
  if (release && !release.draft) stop(`${tag} is released already: ${release.html_url}`);
  if (release) note(`Using the draft an earlier run left: ${release.html_url}`);
  else release = await github("POST", `/repos/${OWNER}/${REPO}/releases`, { tag_name: tag, name, body: notes, draft: true, prerelease: false });

  for (const file of files) {
    const old = (release.assets ?? []).find((asset) => asset.name === path.basename(file));
    if (old) await github("DELETE", `/repos/${OWNER}/${REPO}/releases/assets/${old.id}`);
    note(`Uploading ${path.basename(file)} (${megabytes(file)})`);
    await upload(release, file);
  }

  const assets = await github("GET", `/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`);
  for (const file of files) {
    const asset = assets.find((entry) => entry.name === path.basename(file));
    if (!asset || asset.state !== "uploaded" || asset.size !== statSync(file).size) {
      stop(`GitHub doesn't hold ${path.basename(file)} as it was sent (${asset ? `${asset.state}, ${asset.size} bytes` : "missing"}). The release is still a draft: ${release.html_url}`);
    }
  }
  const back = await download(assets.find((entry) => entry.name === path.basename(yml)));
  if (!back.equals(readFileSync(yml))) stop(`latest-mac.yml came back from GitHub different from the one sent. The release is still a draft: ${release.html_url}`);
  note(`GitHub holds all ${files.length} files at their sizes, and latest-mac.yml came back byte for byte.`);

  const published = await github("PATCH", `/repos/${OWNER}/${REPO}/releases/${release.id}`, { tag_name: tag, name, body: notes, draft: false, prerelease: false, make_latest: "true" });
  note(`Published: ${published.html_url}`);

  // What Avanzel's updater reads, signed out: the latest release, then that release's latest-mac.yml.
  const latest = await fetch(`https://github.com/${OWNER}/${REPO}/releases/latest`, { headers: { Accept: "application/json" } }).catch(() => null);
  const latestTag = latest?.ok ? (await latest.json().catch(() => ({}))).tag_name : null;
  const feed = await fetch(`https://github.com/${OWNER}/${REPO}/releases/download/${tag}/latest-mac.yml`).catch(() => null);
  const feedBytes = feed?.ok ? Buffer.from(await feed.arrayBuffer()) : null;
  if (latestTag === tag && feedBytes?.equals(readFileSync(yml))) {
    note(`Signed out, GitHub shows ${tag} as the latest release and serves its latest-mac.yml: the updater will find it.`);
  } else {
    note(
      `The release is up, but signed out GitHub ${latestTag === tag ? "doesn't serve its latest-mac.yml" : `shows ${latestTag ?? "nothing"} as the latest release`} yet. ` +
        "Avanzel's updater reads it signed out, so check that the repo is public. Nothing needs publishing again.",
    );
  }
}

// ---- The release

async function main() {
  step("Checking what to build");
  const status = capture("git", ["-C", repoRoot, "status", "--porcelain"]);
  if (status.status !== 0) stop(`git status failed: ${status.all}`);
  if (status.stdout.trim()) {
    if (!options.allowDirty) stop(`The git tree has changes. Commit them or set them aside first, so the release is exactly a commit:\n${status.stdout}`);
    note(`The tree has uncommitted changes (--allow-dirty), so this build isn't exactly a commit:\n${status.stdout.trimEnd()}`);
  }
  const head = capture("git", ["-C", repoRoot, "rev-parse", "HEAD"]).stdout.trim();
  const { version } = JSON.parse(readFileSync(path.join(mac, "package.json"), "utf8"));
  const tag = `v${version}`;
  for (const file of ["LICENSE", "NOTICE"]) {
    if (!existsSync(path.join(repoRoot, file))) stop(`The repo has no ${file} at its root. The app ships it in Contents/Resources, so a release needs it.`);
  }
  const signer = options.local ? localSigner() : developerIdSigner();
  note(`Avanzel ${version} from ${head.slice(0, 7)}, signed with ${signer.name}.`);

  let notarizing = false;
  if (options.local) {
    note(
      "A --local dry run: the release as it would be, with the hardened runtime but library validation off, which a self-made identity needs.\n" +
        "It isn't notarized, and Gatekeeper rejects it: Apple notarizes Developer ID builds only.",
    );
  } else {
    const history = capture("xcrun", ["notarytool", "history", "--keychain-profile", PROFILE]);
    notarizing = history.status === 0;
    if (!notarizing && options.publish) stop(`The notary profile ${PROFILE} doesn't work, and a Developer ID release is published notarized only (RELEASING.md):\n${history.all}`);
    note(notarizing ? `The notary profile ${PROFILE} works: the app and the DMG will be notarized.` : `The notary profile ${PROFILE} doesn't work, so this build won't be notarized (RELEASING.md):\n${history.all}`);
  }
  if (options.publish) await checkPublishable(tag, head);

  const out = path.join(mac, "release", options.local ? `${version}-local` : version);
  const app = path.join(out, "mac-arm64", "Avanzel.app");

  step("Building the helpers, the icon and the app's code");
  rmSync(out, { recursive: true, force: true });
  for (const script of ["build-calltap.mjs", "build-cursor.mjs", "make-icon.mjs", "build.mjs"]) run(process.execPath, [path.join("scripts", script)]);
  for (const helper of HELPERS) {
    if (!existsSync(path.join(mac, helper.built))) stop(`${helper.built} wasn't built, and a release needs it. Is swiftc installed? (xcode-select --install)`);
  }

  // The entitlements this build is signed with. A --local build turns library validation off in the app and in
  // Electron's helper apps, which load Electron's framework too.
  const entitlements = {
    app: path.join(mac, "build/entitlements.mac.plist"),
    inherit: path.join(mac, "build/entitlements.mac.inherit.plist"),
  };
  if (options.local) {
    const dir = scratchDir("avanzel-entitlements-");
    for (const kind of ["app", "inherit"]) {
      const copy = path.join(dir, path.basename(entitlements[kind]));
      copyFileSync(entitlements[kind], copy);
      run("/usr/libexec/PlistBuddy", ["-c", `Add :${LIBRARY_VALIDATION} bool true`, copy]);
      entitlements[kind] = copy;
    }
  }

  step("Signing the helpers");
  for (const helper of HELPERS) {
    const extra = helper.entitlements ? ["--entitlements", path.join(mac, helper.entitlements)] : [];
    run("codesign", ["--force", "--sign", signer.hash, "--options", "runtime", "--timestamp", "--identifier", helper.identifier, ...extra, path.join(mac, helper.built)]);
  }

  const builderEnv = { ...childEnv, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "CSC_KEYCHAIN", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE"]) {
    delete builderEnv[key];
  }
  const builder = ["--no-install", "electron-builder", "--config", "electron-builder.release.yml", "--publish", "never", `-c.directories.output=${out}`];

  step("Packaging and signing the app");
  run("npx", [...builder, "--mac", "dir", `-c.mac.identity=${signer.hash}`, `-c.mac.entitlements=${entitlements.app}`, `-c.mac.entitlementsInherit=${entitlements.inherit}`], { env: builderEnv });
  if (!existsSync(app)) stop(`electron-builder made no ${app}.`);

  if (notarizing) {
    step("Notarizing the app");
    const zip = path.join(scratchDir("avanzel-notarize-"), "Avanzel.zip");
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
    notarize(zip, "the app");
    run("xcrun", ["stapler", "staple", app]);
  }

  step("Making the DMG, the ZIP and latest-mac.yml");
  run("npx", [...builder, "--mac", "--prepackaged", app], { env: builderEnv });
  const artifacts = readdirSync(out);
  const one = (ending) => {
    const found = artifacts.filter((name) => name.endsWith(ending));
    if (found.length !== 1) stop(`Expected one ${ending} in ${out}, found ${found.length}.`);
    return path.join(out, found[0]);
  };
  const dmg = one(".dmg");
  const zip = one(".zip");
  const blockmap = `${zip}.blockmap`;
  const yml = path.join(out, "latest-mac.yml");

  step("Signing the DMG");
  run("codesign", ["--force", "--sign", signer.hash, "--timestamp", dmg]);
  if (notarizing) {
    step("Notarizing the DMG");
    notarize(dmg, "the DMG");
    run("xcrun", ["stapler", "staple", dmg]);
  }

  step("Checking the release");
  const results = [];
  const check = (title, fn) => {
    try {
      const detail = fn();
      results.push("pass");
      note(`pass  ${title}${detail ? `: ${detail}` : ""}`);
    } catch (error) {
      results.push("fail");
      note(`fail  ${title}: ${error.message}`);
    }
  };
  const skip = (title, why) => {
    results.push("skip");
    note(`skip  ${title}: ${why}`);
  };
  const short = (key) => key.replace(/^com\.apple\.security\./, "");
  const built = signature(app);

  check("The app's signature holds, all it contains included (codesign --verify --deep --strict)", () => {
    mustRun("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  });

  const helperApps = readdirSync(path.join(app, "Contents/Frameworks")).filter((name) => name.endsWith(".app")).sort();
  const signed = [
    { label: "Avanzel.app", file: app, entitlements: plistKeys(entitlements.app) },
    ...helperApps.map((name) => ({ label: name, file: path.join(app, "Contents/Frameworks", name), entitlements: plistKeys(entitlements.inherit) })),
    ...HELPERS.map((helper) => ({ label: helper.name, file: path.join(app, helper.inApp), entitlements: helper.entitlements ? plistKeys(path.join(mac, helper.entitlements)) : [], identifier: helper.identifier })),
  ];
  for (const item of signed) {
    check(`${item.label}: hardened runtime, signed by ${signer.name} with a secure timestamp, its own entitlements`, () => {
      const found = signature(item.file);
      must(found.runtime, "no hardened runtime");
      must(found.authority === signer.name, `signed by ${found.authority ?? "nobody"}`);
      must(found.timestamp, "no secure timestamp");
      if (signer.team) must(found.team === signer.team, `team ${found.team}, not ${signer.team}`);
      if (item.identifier) must(found.identifier === item.identifier, `identifier ${found.identifier}`);
      must(found.entitlements.join() === item.entitlements.join(), `entitlements ${found.entitlements.map(short).join(", ") || "none"}, not ${item.entitlements.map(short).join(", ") || "none"}`);
      return item.entitlements.length ? item.entitlements.map(short).join(", ") : "no entitlements";
    });
  }

  check(`The app's designated requirement names ${BUNDLE_ID}${signer.team ? ` and the team ${signer.team}` : ""}`, () => {
    const line = built.requirement;
    must(line.includes(`identifier "${BUNDLE_ID}"`), `it is ${line || "missing"}`);
    if (signer.team) must(line.includes(`certificate leaf[subject.OU] = ${signer.team}`) || line.includes(`certificate leaf[subject.OU] = "${signer.team}"`), `it doesn't name the team: ${line}`);
    return line.replace(/^designated => /, "");
  });

  check("Electron's fuses", () => {
    const states = fuseStates(app);
    for (const fuse of FUSES) must(states[fuse.index] === (fuse.on ? 0x31 : 0x30), `${fuse.name} is ${String.fromCharCode(states[fuse.index] ?? 63)}, should be ${fuse.on ? "on" : "off"}`);
    return FUSES.map((fuse) => `${fuse.name} ${fuse.on ? "on" : "off"}`).join(", ");
  });

  check(`Info.plist: ${BUNDLE_ID} ${version}, with the asar's integrity hash`, () => {
    const info = JSON.parse(mustRun("plutil", ["-convert", "json", "-o", "-", path.join(app, "Contents/Info.plist")]));
    must(info.CFBundleIdentifier === BUNDLE_ID, `the identifier is ${info.CFBundleIdentifier}`);
    must(info.CFBundleShortVersionString === version, `the version is ${info.CFBundleShortVersionString}`);
    must(info.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash, "no ElectronAsarIntegrity");
  });

  check("The licence texts in Contents/Resources", () => {
    const resources = path.join(app, "Contents/Resources");
    for (const file of ["LICENSE", "NOTICE"]) {
      must(existsSync(path.join(resources, file)) && readFileSync(path.join(resources, file)).equals(readFileSync(path.join(repoRoot, file))), `${file} isn't the repo's`);
    }
    const folder = path.join(resources, "licenses");
    must(existsSync(folder), "there is no licenses folder");
    const files = readdirSync(folder);
    for (const file of ["README.txt", "LICENSES.chromium.html", "onnxruntime-LICENSE.txt", "onnxruntime-ThirdPartyNotices.txt"]) must(files.includes(file), `licenses/${file} is missing`);
    for (const file of files) must(statSync(path.join(folder, file)).size > 0, `licenses/${file} is empty`);
    return `LICENSE, NOTICE and ${files.length} files in licenses/`;
  });

  check("The ZIP unpacks, as the updater unpacks it, to this same app with its signature whole", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "avanzel-zip-"));
    try {
      mustRun("ditto", ["-x", "-k", zip, dir]);
      const entries = readdirSync(dir);
      must(entries.join() === "Avanzel.app", `it holds ${entries.join(", ")}`);
      const unpacked = path.join(dir, "Avanzel.app");
      mustRun("codesign", ["--verify", "--deep", "--strict", unpacked]);
      const found = signature(unpacked);
      must(found.cdhash === built.cdhash, "it holds a different app");
      must(found.requirement === built.requirement, "its designated requirement differs");
      if (notarizing) mustRun("xcrun", ["stapler", "validate", unpacked]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return `${megabytes(zip)}`;
  });

  check("The DMG is whole, signed, and holds this same app", () => {
    mustRun("hdiutil", ["verify", dmg]);
    const found = signature(dmg);
    must(found.authority === signer.name && found.timestamp, `signed by ${found.authority ?? "nobody"}${found.timestamp ? "" : ", without a secure timestamp"}`);
    const mount = mkdtempSync(path.join(tmpdir(), "avanzel-dmg-"));
    mustRun("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount]);
    try {
      const inside = path.join(mount, "Avanzel.app");
      mustRun("codesign", ["--verify", "--deep", "--strict", inside]);
      must(signature(inside).cdhash === built.cdhash, "it holds a different app");
      must(existsSync(path.join(mount, "Applications")), "it has no Applications link to drag the app to");
      if (notarizing) mustRun("xcrun", ["stapler", "validate", inside]);
    } finally {
      if (capture("hdiutil", ["detach", mount]).status !== 0) capture("hdiutil", ["detach", "-force", mount]);
      // Only once nothing is mounted there any more: rmdir refuses a folder that isn't empty.
      try {
        rmdirSync(mount);
      } catch {
        note(`The DMG may still be mounted at ${mount}: hdiutil detach ${mount}`);
      }
    }
    return `${megabytes(dmg)}`;
  });

  check("latest-mac.yml describes exactly this ZIP", () => {
    const text = readFileSync(yml, "utf8");
    const name = path.basename(zip);
    const sha512 = createHash("sha512").update(readFileSync(zip)).digest("base64");
    const size = statSync(zip).size;
    const field = (key, indent = "") => [...text.matchAll(new RegExp(`^${indent}${key}: (.+)$`, "gm"))].map((match) => match[1].trim());
    must(field("version").join() === version, `its version is ${field("version").join()}`);
    must(field("url", "\\s+- ").join() === name, `it lists ${field("url", "\\s+- ").join(", ")}`);
    must(field("sha512", "\\s+").join() === sha512 && field("size", "\\s+").join() === String(size), "the ZIP's sha512 or size differs");
    must(field("path").join() === name && field("sha512").join() === sha512, "its path or sha512 differs");
    must(existsSync(blockmap) && statSync(blockmap).size > 0, "the ZIP has no blockmap");
    return `${name}, sha512 ${sha512.slice(0, 16)}…, ${size} bytes`;
  });

  if (notarizing) {
    check("Gatekeeper accepts the app (spctl -a -t exec)", () => mustRun("spctl", ["-a", "-t", "exec", "-vv", app]).split("\n").find((line) => line.startsWith("source=")));
    check("Gatekeeper accepts the DMG (spctl -a -t open --context context:primary-signature)", () =>
      mustRun("spctl", ["-a", "-t", "open", "--context", "context:primary-signature", "-vv", dmg]).split("\n").find((line) => line.startsWith("source=")));
    check("The app and the DMG carry their notarization tickets (stapler validate)", () => {
      mustRun("xcrun", ["stapler", "validate", app]);
      mustRun("xcrun", ["stapler", "validate", dmg]);
    });
  } else {
    skip(
      "Notarization, stapling and Gatekeeper's acceptance (spctl)",
      options.local ? "Apple notarizes Developer ID builds only, and Gatekeeper rejects any other until a person allows it" : `the notary profile ${PROFILE} doesn't work`,
    );
  }

  const failed = results.filter((result) => result === "fail").length;
  note(`\n${results.filter((result) => result === "pass").length} passed, ${failed} failed, ${results.filter((result) => result === "skip").length} skipped.`);
  if (failed) stop(`The release didn't pass its checks, so nothing is published. The build is in ${out}.`);

  step("Writing SHA256SUMS.txt");
  const uploads = [dmg, zip, blockmap, yml];
  const sums = path.join(out, "SHA256SUMS.txt");
  writeFileSync(sums, uploads.map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${path.basename(file)}\n`).join(""));
  note(readFileSync(sums, "utf8").trimEnd());

  if (!options.allowDirty) {
    const after = capture("git", ["-C", repoRoot, "status", "--porcelain"]).stdout.trim();
    if (after) stop(`The build changed tracked or unignored files, so it isn't exactly the commit:\n${after}`);
  }

  console.log(`\nThe release is in ${out}:`);
  for (const file of [...uploads, sums]) console.log(`   ${path.basename(file)}  ${megabytes(file)}`);
  if (options.local) {
    console.log("\nA dry run signed with Avanzel Local: not notarized, Gatekeeper rejects it, and it isn't for publishing.");
  } else if (!notarizing) {
    console.log("\nNot notarized: Gatekeeper rejects this build. Make the notary profile (RELEASING.md) and build again before publishing.");
  }

  if (options.publish) {
    const notes = options.notes ? readFileSync(options.notes, "utf8") : defaultNotes(version, path.basename(dmg));
    await publish({ tag, version, files: [...uploads, sums], yml, notes });
  }
}

main().catch((error) => stop(error.stack ?? String(error)));
