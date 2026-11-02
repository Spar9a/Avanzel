// Bundles the Electron main process (ESM), preload (CJS, as sandboxed preloads require) and the
// React renderers, then copies HTML, CSS, the engine's templates and assets into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { distDir, runningMessage, suiteRunning } from "./e2e-lock.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = distDir(root);
const engineTemplates = path.join(root, "..", "..", "packages", "engine", "templates");
const watch = process.argv.includes("--watch");

if (suiteRunning(root) && !process.env.AVANZEL_DIST) {
  console.error(runningMessage());
  process.exit(1);
}
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: "warning", absWorkingDir: root };

await build({
  ...common,
  entryPoints: { main: "src/main/index.ts" },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", "onnxruntime-node"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  ...common,
  entryPoints: { preload: "src/preload/index.ts" },
  outdir: dist,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

const rendererDir = path.join(root, "src", "renderer");
const pages = existsSync(rendererDir)
  ? readdirSync(rendererDir).filter((name) => existsSync(path.join(rendererDir, name, "main.tsx")))
  : [];
if (pages.length) {
  await build({
    ...common,
    entryPoints: Object.fromEntries(pages.map((p) => [`renderer/${p}/main`, `src/renderer/${p}/main.tsx`])),
    outdir: dist,
    platform: "browser",
    format: "esm",
    target: "chrome130",
    jsx: "automatic",
    loader: { ".css": "css", ".woff2": "file" }, // @avanzel/ui bundles its fonts; windows load only local files
  });
  for (const p of pages) {
    for (const file of readdirSync(path.join(rendererDir, p))) {
      if (file.endsWith(".html") || file.endsWith(".js") && file.includes("worklet")) {
        cpSync(path.join(rendererDir, p, file), path.join(dist, "renderer", p, file));
      }
    }
  }
}

cpSync(engineTemplates, path.join(dist, "templates"), { recursive: true });
const engineAssets = path.join(root, "..", "..", "packages", "engine", "assets");
if (existsSync(engineAssets)) cpSync(engineAssets, path.join(dist, "engine-assets"), { recursive: true });
if (existsSync(path.join(root, "assets"))) cpSync(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });
console.log(`built ${pages.length} renderer(s) into ${dist === path.join(root, "dist") ? "dist" : dist}/${watch ? " (watch not implemented)" : ""}`);
