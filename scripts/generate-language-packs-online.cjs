const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const { handleTranslationRequest } = require("../translation-core.cjs");
const { extractTranslationSources, isValidPack, setBundledLanguagePacks } = require("./build-language-packs.cjs");

const ROOT = path.resolve(__dirname, "..");

async function writeJsonAtomically(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function readPack(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function generateLanguagePacksOnline({
  root = ROOT,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) {
    throw new Error("Set GEMINI_API_KEY privately in the environment before generating bundled language packs.");
  }

  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const languages = Object.keys(LOCALES);
  const packDirectory = path.join(root, "language-packs");
  await fs.mkdir(packDirectory, { recursive: true });

  await setBundledLanguagePacks(false, root);
  const generatedLanguages = [];
  const reusedLanguages = [];

  for (const language of languages) {
    const packPath = path.join(packDirectory, `${language}.json`);
    const existingPack = await readPack(packPath);
    if (isValidPack(existingPack, language, sourceHash, sources)) {
      reusedLanguages.push(language);
      continue;
    }

    const result = await handleTranslationRequest({ language, texts: sources }, { apiKey, fetchImpl });
    if (result.status !== 200 || result.body.language !== language) {
      throw new Error(`Could not create a complete ${language} translation pack: ${result.body.error || "Unexpected translation response."}`);
    }

    const pack = {
      language,
      sourceHash,
      translations: Object.fromEntries(sources.map((source, index) => [source, result.body.translations[index]]))
    };
    if (!isValidPack(pack, language, sourceHash, sources)) {
      throw new Error(`The generated ${language} pack failed completeness or placeholder validation.`);
    }
    await writeJsonAtomically(packPath, pack);
    generatedLanguages.push(language);
  }

  await writeJsonAtomically(path.join(packDirectory, "manifest.json"), {
    sourceHash,
    languages,
    sourceCount: sources.length
  });
  await setBundledLanguagePacks(true, root);
  return { sourceCount: sources.length, generatedLanguages, reusedLanguages, languages };
}

if (require.main === module) {
  generateLanguagePacksOnline()
    .then(({ sourceCount, generatedLanguages, reusedLanguages, languages }) => {
      console.log(`Bundled language packs are ready: ${generatedLanguages.length} generated, ${reusedLanguages.length} reused, ${languages.length} languages, ${sourceCount} interface strings.`);
      console.log("These are machine translations; review emergency and wellbeing wording with fluent speakers before relying on it.");
    })
    .catch((error) => {
      console.error(`[language-pack-generation] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { generateLanguagePacksOnline };
