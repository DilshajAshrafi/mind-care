const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const { extractTranslationSources, isValidPack, setBundledLanguagePacks } = require("./build-language-packs.cjs");

const ROOT = path.resolve(__dirname, "..");

async function prepareOnlineBuild({ root = ROOT } = {}) {
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  const languages = Object.keys(LOCALES);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const packDirectory = path.join(root, "language-packs");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(packDirectory, "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  let bundledLanguagePacks = manifest?.sourceHash === sourceHash
    && manifest.sourceCount === sources.length
    && Array.isArray(manifest.languages)
    && manifest.languages.length === languages.length
    && languages.every((language) => manifest.languages.includes(language));

  if (bundledLanguagePacks) {
    for (const language of languages) {
      let pack;
      try {
        pack = JSON.parse(await fs.readFile(path.join(packDirectory, `${language}.json`), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      if (!isValidPack(pack, language, sourceHash, sources)) {
        bundledLanguagePacks = false;
        break;
      }
    }
  }

  await setBundledLanguagePacks(bundledLanguagePacks, root);
  return { languageCount: languages.length, sourceCount: sources.length, bundledLanguagePacks };
}

if (require.main === module) {
  prepareOnlineBuild()
    .then(({ languageCount, sourceCount, bundledLanguagePacks }) => {
      const packStatus = bundledLanguagePacks ? "Complete language packs will be available offline." : "First-time translation needs GEMINI_API_KEY; each successful language is saved locally for offline use.";
      console.log(`Online translation build ready: ${languageCount} languages, ${sourceCount} interface strings. ${packStatus}`);
    })
    .catch((error) => {
      console.error(`[online-build] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { prepareOnlineBuild };
