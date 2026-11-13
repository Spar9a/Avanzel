// Puts the licence texts of everything Avanzel for Mac bundles into the app's Contents/Resources/licenses, with a
// README.txt that lists them. electron-builder runs it as its afterExtract hook (electron-builder.yml), right after it
// unpacks Electron: Electron's own LICENSE and LICENSES.chromium.html (Chromium and what it includes, FFmpeg among them)
// still lie beside the app then, and electron-builder deletes them next. Avanzel's own LICENSE and NOTICE come in as
// extraResources; NOTICE names what is here.
//
// The build stops when a licence text is missing, or when dist bundles an npm package that BUNDLED doesn't list, so
// nothing new ships without its licence.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mac = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(mac, "..", "..");

/**
 * The npm packages esbuild bundles into dist: React in the windows; smol-toml, electron-updater with what it needs, and the MCP
 * SDK with what it needs (Avanzel --mcp), in the main process.
 */
const BUNDLED = [
  "react", "react-dom", "scheduler", "smol-toml",
  "electron-updater", "builder-util-runtime", "lazy-val", "debug", "ms", "has-flag", "supports-color", "fs-extra", "graceful-fs",
  "jsonfile", "universalify", "js-yaml", "lodash.escaperegexp", "lodash.isequal", "sax", "semver",
  "@modelcontextprotocol/sdk", "zod", "zod-to-json-schema", "ajv", "ajv-formats", "fast-deep-equal", "fast-uri", "json-schema-traverse",
];
/** Bundled packages that carry no licence file of their own. Their texts are in apps/mac/licenses. */
const BUNDLED_TEXTS = { "lazy-val": "lazy-val-LICENSE.txt" };
/** The fonts @avanzel/ui bundles. Each licence lies beside the font files. */
const FONTS = ["Nunito", "Literata", "Newsreader"];
/** Packages the app ships that carry no licence file of their own. Their texts are in apps/mac/licenses. */
const VENDORED = {
  "onnxruntime-node": ["onnxruntime-LICENSE.txt", "onnxruntime-ThirdPartyNotices.txt"],
  "onnxruntime-common": ["onnxruntime-LICENSE.txt", "onnxruntime-ThirdPartyNotices.txt"],
};

function fail(message) {
  throw new Error(`scripts/licenses.mjs: ${message}`);
}

/** An installed package's folder, looked for from `from` upward, as Node looks. */
function packageDir(name, from = mac) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === path.dirname(dir)) return null;
  }
}

const manifest = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** The licence file a package carries: LICENSE, LICENCE, COPYING, in any case, with or without an ending. */
function licenceFile(dir) {
  const name = readdirSync(dir).find((file) => /^(licen[cs]e|copying)([.-][\w.-]+)?$/i.test(file) && statSync(path.join(dir, file)).isFile());
  return name ? path.join(dir, name) : null;
}

/** The npm packages bundled into dist, from the source maps esbuild writes beside each bundle. */
function bundledPackages() {
  const dist = path.join(mac, "dist");
  if (!existsSync(dist)) fail(`there is no ${dist} to read. Build it first (node scripts/build.mjs).`);
  const names = new Set();
  const read = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) read(file);
      else if (entry.name.endsWith(".map")) {
        for (const source of JSON.parse(readFileSync(file, "utf8")).sources ?? []) {
          const at = source.lastIndexOf("node_modules/");
          if (at < 0) continue;
          const [first, second] = source.slice(at + "node_modules/".length).split("/");
          names.add(first.startsWith("@") ? `${first}/${second}` : first);
        }
      }
    }
  };
  read(dist);
  return names;
}

/** apps/mac's dependencies and everything they need in turn: what electron-builder puts into app.asar's node_modules. */
function shippedPackages() {
  const found = new Map(); // folder => name
  const visit = (name, from, optional) => {
    const dir = packageDir(name, from);
    if (!dir) {
      if (optional) return;
      fail(`${name} isn't installed. Run npm ci.`);
    }
    if (found.has(dir)) return;
    found.set(dir, name);
    const { dependencies = {}, optionalDependencies = {} } = manifest(dir);
    for (const dep of Object.keys(dependencies)) visit(dep, dir, dep in optionalDependencies);
    for (const dep of Object.keys(optionalDependencies)) visit(dep, dir, true);
  };
  for (const dep of Object.keys(manifest(mac).dependencies ?? {})) visit(dep, mac, false);
  return found;
}

export async function afterExtract(context) {
  if (context.electronPlatformName !== "darwin") return;
  const apps = readdirSync(context.appOutDir).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) fail(`expected one app in ${context.appOutDir}, found ${apps.length}.`);
  const out = path.join(context.appOutDir, apps[0], "Contents", "Resources", "licenses");
  mkdirSync(out, { recursive: true });

  const listed = [];
  const put = (from, name, what) => {
    if (!from || !existsSync(from)) fail(`the licence text of ${what} isn't there${from ? ` (${from})` : ""}.`);
    if (!listed.some((entry) => entry.name === name)) {
      copyFileSync(from, path.join(out, name));
      listed.push({ name, what });
    }
  };
  const fromNpm = (dir, name, where) => {
    const { version } = manifest(dir);
    const file = `${name.replace("/", "-")}-${version}-LICENSE.txt`;
    put(licenceFile(dir), file, `${name} ${version}, ${where}`);
  };

  const electron = manifest(packageDir("electron")).version;
  put(path.join(context.appOutDir, "LICENSE"), `electron-${electron}-LICENSE.txt`, `Electron ${electron}`);
  put(path.join(context.appOutDir, "LICENSES.chromium.html"), "LICENSES.chromium.html", "Chromium and the components it includes (FFmpeg among them), as Electron ships them");

  const unlisted = [...bundledPackages()].filter((name) => !BUNDLED.includes(name));
  if (unlisted.length) fail(`dist bundles ${unlisted.join(", ")}, which BUNDLED doesn't list. Add each, and name it in the repo's NOTICE.`);
  for (const name of BUNDLED) {
    const dir = packageDir(name);
    if (!dir) fail(`${name} isn't installed. Run npm ci.`);
    if (BUNDLED_TEXTS[name]) {
      const { version } = manifest(dir);
      put(path.join(mac, "licenses", BUNDLED_TEXTS[name]), `${name}-${version}-LICENSE.txt`, `${name} ${version}, bundled into the app's code`);
    } else fromNpm(dir, name, "bundled into the app's code");
  }

  for (const [dir, name] of shippedPackages()) {
    if (VENDORED[name]) {
      const { version } = manifest(dir);
      for (const file of VENDORED[name]) put(path.join(mac, "licenses", file), file, `ONNX Runtime ${version} (onnxruntime-node, onnxruntime-common)`);
    } else {
      fromNpm(dir, name, "in app.asar's node_modules");
    }
  }

  const fonts = path.join(repo, "packages", "ui", "src", "fonts");
  for (const font of FONTS) put(path.join(fonts, `${font}-OFL.txt`), `${font}-OFL.txt`, `the ${font} font, bundled with the app's windows`);
  put(path.join(repo, "packages", "engine", "assets", "NOTICE.md"), "onnx-asr-NOTICE.md", "onnx-asr, whose ONNX files the app uses to prepare speech");

  const width = Math.max(...listed.map((entry) => entry.name.length));
  const index = [
    "Avanzel is licensed under the Apache License, Version 2.0: its text is in ../LICENSE, and ../NOTICE credits",
    "the third-party material in this app. This folder holds the licence texts of that material:",
    "",
    ...listed.map((entry) => `${entry.name.padEnd(width)}  ${entry.what}`),
    "",
  ];
  writeFileSync(path.join(out, "README.txt"), index.join("\n"));
  console.log(`  • licence texts  count=${listed.length} folder=${path.relative(context.appOutDir, out)}`);
}

export default afterExtract;
