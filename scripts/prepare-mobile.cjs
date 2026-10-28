const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const { extractTranslationSources } = require("./build-language-packs.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIRECTORY = path.join(ROOT, "dist");
const APP_ASSETS = [
  "index.html",
  "styles.css",
  "script.js",
  "translation-catalog.js",
  "app-config.js",
  "favicon.svg",
  "manifest.webmanifest",
  "service-worker.js"
];
const PLACEHOLDER_PATTERN = /\{\{[^{}]+\}\}/g;

function assertApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MIND_CARE_API_BASE_URL must be an absolute HTTPS URL for the deployed chat backend.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("MIND_CARE_API_BASE_URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

async function prepareMobile({
  root = ROOT,
  outputDirectory = path.join(root, "dist"),
  apiBaseUrl = process.env.MIND_CARE_API_BASE_URL
} = {}) {
  if (!apiBaseUrl) {
    throw new Error("Set MIND_CARE_API_BASE_URL to the deployed HTTPS chat API before building the mobile app.");
  }
  const chatApiBaseUrl = assertApiBaseUrl(apiBaseUrl);
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const packDirectory = path.join(root, "language-packs");
  const missingLanguages = [];
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(packDirectory, "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  const expectedLanguages = Object.keys(LOCALES);
  const manifestIsValid = manifest?.sourceHash === sourceHash
    && manifest.sourceCount === sources.length
    && Array.isArray(manifest.languages)
    && expectedLanguages.every((language) => manifest.languages.includes(language))
    && manifest.languages.length === expectedLanguages.length;
  if (!manifestIsValid) {
    throw new Error("The language-pack manifest is missing, outdated, or incomplete. Build all 23 language packs first.");
  }

  for (const language of expectedLanguages) {
    let pack;
    try {
      pack = JSON.parse(await fs.readFile(path.join(packDirectory, `${language}.json`), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }

    const translations = pack?.translations;
    const validPack = pack?.language === language
      && pack.sourceHash === sourceHash
      && translations
      && typeof translations === "object"
      && !Array.isArray(translations)
      && sources.every((source) => {
        const translation = translations[source];
        const sourceTokens = source.match(PLACEHOLDER_PATTERN) || [];
        const translationTokens = typeof translation === "string" ? translation.match(PLACEHOLDER_PATTERN) || [] : [];
        return typeof translation === "string"
          && translation.trim()
          && sourceTokens.length === translationTokens.length
          && sourceTokens.every((token, index) => token === translationTokens[index]);
      });
    if (!validPack) missingLanguages.push(language);
  }

  if (missingLanguages.length) {
    throw new Error(`Missing complete, current language packs: ${missingLanguages.join(", ")}. Build and verify all packs before packaging the offline app.`);
  }

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const asset of APP_ASSETS) {
    await fs.copyFile(path.join(root, asset), path.join(outputDirectory, asset));
  }
  await fs.cp(packDirectory, path.join(outputDirectory, "language-packs"), { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "app-config.js"),
    `globalThis.MIND_CARE_APP_CONFIG = Object.freeze({ chatApiBaseUrl: ${JSON.stringify(chatApiBaseUrl)} });\n`,
    "utf8"
  );
  return { chatApiBaseUrl, languages: Object.keys(LOCALES), outputDirectory };
}

if (require.main === module) {
  prepareMobile()
    .then(({ languages, outputDirectory }) => {
      console.log(`Mobile web app ready in ${outputDirectory} with ${languages.length} offline language packs.`);
    })
    .catch((error) => {
      console.error(`[mobile-build] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { assertApiBaseUrl, prepareMobile };
