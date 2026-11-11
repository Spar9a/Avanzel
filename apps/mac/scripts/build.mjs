// Bundles the Electron main process (ESM), preload (CJS, as sandboxed preloads require) and the
// React renderers, then copies HTML, CSS, the engine's templates and assets into dist/.
// With --watch it keeps rebuilding each part as its sources change (theirs and @avanzel/ui's, @avanzel/engine's alike), and, when
// started with an IPC channel (scripts/dev.mjs), tells its parent which part was rebuilt: { built: "main" | "preload" | "renderer" }.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appIconPng } from "../src/main/app-icon.ts";
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

const rendererDir = path.join(root, "src", "renderer");
const pages = existsSync(rendererDir)
  ? readdirSync(rendererDir).filter((name) => existsSync(path.join(rendererDir, name, "main.tsx")))
  : [];

/** Each page's HTML and audio worklets go beside its bundle. */
function copyPageFiles() {
  for (const p of pages) {
    for (const file of readdirSync(path.join(rendererDir, p))) {
      if (file.endsWith(".html") || file.endsWith(".js") && file.includes("worklet")) {
        mkdirSync(path.join(dist, "renderer", p), { recursive: true });
        cpSync(path.join(rendererDir, p, file), path.join(dist, "renderer", p, file));
      }
    }
  }
}

const parts = [
  {
    name: "main",
    options: {
      ...common,
      entryPoints: { main: "src/main/index.ts" },
      outdir: dist,
      outExtension: { ".js": ".mjs" },
      platform: "node",
      format: "esm",
      target: "node22",
      external: ["electron", "onnxruntime-node"],
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    },
  },
  {
    name: "preload",
    options: {
      ...common,
      entryPoints: { preload: "src/preload/index.ts" },
      outdir: dist,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
    },
  },
  ...(pages.length
    ? [{
        name: "renderer",
        after: copyPageFiles,
        options: {
          ...common,
          entryPoints: Object.fromEntries(pages.map((p) => [`renderer/${p}/main`, `src/renderer/${p}/main.tsx`])),
          outdir: dist,
          platform: "browser",
          format: "esm",
          target: "chrome130",
          jsx: "automatic",
          loader: { ".css": "css", ".woff2": "file" }, // @avanzel/ui bundles its fonts; windows load only local files
        },
      }]
    : []),
];

function copyStatic() {
  cpSync(engineTemplates, path.join(dist, "templates"), { recursive: true });
  const engineAssets = path.join(root, "..", "..", "packages", "engine", "assets");
  if (existsSync(engineAssets)) cpSync(engineAssets, path.join(dist, "engine-assets"), { recursive: true });
  if (existsSync(path.join(root, "assets"))) cpSync(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });
  // A development build's Dock icon (src/main/index.ts sets it), drawn once here rather than at each launch.
  writeFileSync(path.join(dist, "app-icon.png"), appIconPng(512));
}

const shown = dist === path.join(root, "dist") ? "dist" : dist;

if (!watch) {
  for (const part of parts) {
    await build(part.options);
    part.after?.();
  }
  copyStatic();
  console.log(`built ${pages.length} renderer(s) into ${shown}/`);
} else {
  copyStatic();
  for (const part of parts) {
    const notify = {
      name: "notify",
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length) return console.error(`${part.name}: ${result.errors.length} error(s), kept the last good build`);
          part.after?.();
          console.log(`built ${part.name} into ${shown}/`);
          process.send?.({ built: part.name });
        });
      },
    };
    const ctx = await context({ ...part.options, plugins: [notify] });
    await ctx.watch();
  }
  console.log("watching for changes");
}
