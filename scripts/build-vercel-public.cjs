const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public");
const FILES = [
  "index.html", "script.js", "styles.css", "translation-catalog.js", "app-config.js",
  "service-worker.js", "manifest.webmanifest", "favicon.svg"
];
const DIRS = ["downloads", "language-packs", "icons"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
for (const dir of DIRS) {
  const source = path.join(ROOT, dir);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(OUT, dir), { recursive: true });
}
console.log(`Static site copied to public/ (${FILES.length} files).`);
