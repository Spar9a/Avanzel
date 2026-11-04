// A local code-signing identity for Avanzel builds, so macOS keeps the permissions it was given (Screen Recording,
// Microphone) across rebuilds. An ad-hoc signature is only a hash of that one build: every rebuild looks like a new
// app, and its switch in System Settings stays on while the permission no longer applies.
//
//   node scripts/signing.mjs setup            makes the identity once, in its own keychain (the login keychain is left alone)
//   node scripts/signing.mjs sign <app>       signs the app with it; without it, ad-hoc, with a warning
//
// AVANZEL_SIGN_IDENTITY overrides the identity (a name or SHA-1 hash from `security find-identity -p codesigning`).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NAME = "Avanzel Local";
const KEYCHAIN = join(homedir(), "Library/Keychains/avanzel-dev.keychain-db");
// The keychain holds one throwaway key and nothing else, so its password protects nothing worth guarding.
const PASSWORD = "avanzel";

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });

/** The SHA-1 of the identity in the Avanzel keychain, or null when it has not been made. */
function localIdentity() {
  if (!existsSync(KEYCHAIN)) return null;
  const out = spawnSync("security", ["find-identity", "-v", "-p", "codesigning", KEYCHAIN], { encoding: "utf8" }).stdout ?? "";
  return new RegExp(`([0-9A-F]{40}) "${NAME}"`).exec(out)?.[1] ?? null;
}

/** codesign only finds an identity in a keychain on the user's search list (its own --keychain option is not enough). */
function unlock() {
  run("security", ["unlock-keychain", "-p", PASSWORD, KEYCHAIN]);
  const listed = run("security", ["list-keychains", "-d", "user"]).split("\n").map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (!listed.includes(KEYCHAIN)) run("security", ["list-keychains", "-d", "user", "-s", ...listed, KEYCHAIN]);
}

function setup() {
  if (localIdentity()) {
    console.log(`"${NAME}" is already in ${KEYCHAIN}.`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "avanzel-identity-"));
  try {
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    const bundle = join(dir, "identity.p12");
    run("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650", "-keyout", key, "-out", cert, "-subj", `/CN=${NAME}`,
      "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=critical,codeSigning",
    ]);
    // macOS's `security import` reads the older PKCS#12 encryption, which OpenSSL 3 has to be asked for.
    run("openssl", [
      "pkcs12", "-export", "-inkey", key, "-in", cert, "-out", bundle, "-passout", `pass:${PASSWORD}`,
      "-certpbe", "PBE-SHA1-3DES", "-keypbe", "PBE-SHA1-3DES", "-macalg", "sha1",
    ]);
    if (!existsSync(KEYCHAIN)) run("security", ["create-keychain", "-p", PASSWORD, KEYCHAIN]);
    run("security", ["set-keychain-settings", KEYCHAIN]); // never locks again by itself
    unlock();
    run("security", ["import", bundle, "-k", KEYCHAIN, "-P", PASSWORD, "-T", "/usr/bin/codesign"]);
    // Without this, the first codesign run waits for a click on a dialog.
    run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", PASSWORD, KEYCHAIN]);
    // codesign only takes an identity it trusts, and a self-signed one is not until it is trusted for code signing.
    // This is a per-user trust setting for that one certificate; macOS may ask for your password or Touch ID.
    run("security", ["add-trusted-cert", "-r", "trustRoot", "-p", "codeSign", "-k", KEYCHAIN, cert]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!localIdentity()) throw new Error(`The identity was imported, but ${KEYCHAIN} does not list it.`);
  console.log(`Made "${NAME}" in ${KEYCHAIN}.`);
}

function sign(app) {
  if (!app || !existsSync(app)) throw new Error(`Usage: node scripts/signing.mjs sign <path to Avanzel.app>`);
  const override = process.env.AVANZEL_SIGN_IDENTITY;
  const local = override ? null : localIdentity();
  if (local) unlock();
  const identity = override ?? local;
  if (!identity) {
    console.warn(
      "\nSigning ad-hoc: macOS will treat every rebuild as a new app and drop its Screen Recording and Microphone permissions.\n" +
        "Run `node scripts/signing.mjs setup` once to keep them.\n",
    );
  }
  // The helpers go first, so the app's seal covers the signed files. Each is absent when swiftc was missing at build.
  for (const helper of ["calltap/avanzel-calltap", "cursor/avanzel-cursor"]) {
    const path = join(app, "Contents/Resources", helper);
    if (existsSync(path)) run("codesign", ["--force", "--sign", identity ?? "-", path]);
  }
  run("codesign", ["--force", "--deep", "--sign", identity ?? "-", app]);
  const shown = spawnSync("codesign", ["-d", "-r-", app], { encoding: "utf8" });
  const requirement = `${shown.stdout}${shown.stderr}`.split("\n").find((line) => line.startsWith("designated"));
  console.log(`Signed ${app}\n${requirement ?? ""}`);
}

const [command, target] = process.argv.slice(2);
if (command === "setup") setup();
else if (command === "sign") sign(target);
else {
  console.error("Use: node scripts/signing.mjs setup | sign <path to Avanzel.app>");
  process.exit(1);
}
