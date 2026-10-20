// Builds the gallery into gallery/dist/: index.html with the script and styles inlined, and the brand
// fonts as files beside it, which is what the screenshot tests open.
// `--preview` writes one self-contained file, gallery/dist/preview.html, that loads the faces from
// Google Fonts instead. `--static` renders the components to plain HTML first (no React in the page),
// which is small enough to show inline in a chat thread: gallery/dist/static.html.
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UI_ROOT } from "./tokens-lib.mjs";

const staticPage = process.argv.includes("--static");
const preview = staticPage || process.argv.includes("--preview");
const out = path.join(UI_ROOT, "gallery", "dist");
if (!preview) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const GOOGLE_FONTS = "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;1,7..72,400&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Nunito:wght@700;800;900&display=swap";

/** In the preview, fonts.css becomes nothing; the page links Google Fonts and the token stacks fall back to them. */
const dropBundledFonts = {
  name: "drop-bundled-fonts",
  setup(b) {
    b.onResolve({ filter: /fonts\.css$/ }, (args) => ({ path: args.path, namespace: "empty-css" }));
    b.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({ contents: "", loader: "css" }));
  },
};

/** The theme probe main.tsx runs, as plain script for the static page. */
const THEME_PROBE = `(()=>{const r=document.documentElement,b=getComputedStyle(r).getPropertyValue("--background").trim();if(!b)return;const c=document.createElement("canvas").getContext("2d");c.fillStyle=b;c.fillRect(0,0,1,1);const[R,G,B]=c.getImageData(0,0,1,1).data;r.dataset.appearance=.2126*R+.7152*G+.0722*B<128?"dark":"light"})();`;

if (staticPage) {
  const server = await build({
    entryPoints: [path.join(UI_ROOT, "gallery", "static.tsx")],
    bundle: true,
    write: false,
    outdir: out,
    format: "esm",
    platform: "node",
    packages: "external",
    jsx: "automatic",
    minify: true,
    loader: { ".css": "css" },
    plugins: [dropBundledFonts],
    logLevel: "warning",
  });
  const js = server.outputFiles.find((f) => f.path.endsWith(".js"));
  const css = server.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
  const module = path.join(out, "static-render.mjs");
  writeFileSync(module, js.text);
  const { markup } = await import(pathToFileURL(module).href);
  rmSync(module);
  // Zel's drawing is the same in every mood (only the svg's data attributes differ), so the page
  // carries it once and fills each <svg class="av-zel"> when it loads.
  let art = "";
  const html = markup().replace(/(<svg class="av-zel"[^>]*>)([\s\S]*?)(<\/svg>)(?=<\/span>|<|$)/g, (m, open, inner, close) => {
    if (!inner.includes("av-zel-knob")) return m;
    art ||= inner;
    return open + close;
  });
  const fill = `<template id="zel-art"><svg>${art}</svg></template><script>(()=>{const a=document.getElementById("zel-art").content.firstElementChild.innerHTML;document.querySelectorAll("svg.av-zel").forEach((s)=>{if(!s.firstElementChild)s.innerHTML=a})})();</script>`;
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Avanzel UI gallery</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${GOOGLE_FONTS}"><style>${css}</style><script>${THEME_PROBE}</script></head><body>${html}${fill}</body></html>\n`;
  writeFileSync(path.join(out, "static.html"), page);
  console.log(`Wrote gallery/dist/static.html (${Math.round(page.length / 1024)} KB)`);
  process.exit(0);
}

const result = await build({
  entryPoints: [path.join(UI_ROOT, "gallery", "main.tsx")],
  bundle: true,
  write: false,
  outdir: out,
  format: "esm",
  target: "chrome130",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  loader: { ".woff2": "file", ".css": "css" },
  assetNames: "[name]",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: preview ? [dropBundledFonts] : [],
  logLevel: "warning",
});

let js = "";
let css = "";
for (const file of result.outputFiles) {
  if (file.path.endsWith(".js")) js = file.text;
  else if (file.path.endsWith(".css")) css = file.text;
  else writeFileSync(file.path, file.contents);
}
const fontLink = preview ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${GOOGLE_FONTS}">` : "";
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Avanzel UI gallery</title>
${fontLink}
<style>${css.replaceAll("</style", "<\\/style")}</style>
</head>
<body>
<div id="root"></div>
<script type="module">${js.replaceAll("</script", "<\\/script")}</script>
</body>
</html>
`;
const file = path.join(out, preview ? "preview.html" : "index.html");
writeFileSync(file, html);
console.log(`Wrote ${path.relative(process.cwd(), file)} (${Math.round(html.length / 1024)} KB)`);
