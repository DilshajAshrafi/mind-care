const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const catalog = require("../translation-catalog.js");
const {
  MAX_TRANSLATION_CHARACTERS,
  MAX_TRANSLATION_ITEMS,
  handleTranslationRequest
} = require("../translation-core.cjs");

const ROOT = path.resolve(__dirname, "..");
const PACK_DIRECTORY = path.join(ROOT, "language-packs");
const MANIFEST_PATH = path.join(PACK_DIRECTORY, "manifest.json");
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const EXCLUDED_IDS = new Set([
  "contact-list", "plan-list", "mood-history-list", "feedback-list",
  "mood-response", "task-response", "sleep-response", "needs-response", "chat-status",
  "journal-status", "journal-counter", "settings-status"
]);
const EXCLUDED_CLASSES = new Set(["language-control"]);
const PLACEHOLDER_PATTERN = /\{\{[^{}]+\}\}/g;
const ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: "\""
});

function decodeHtmlEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const isHex = code[1].toLowerCase() === "x";
      const value = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }
    return ENTITIES[code] || entity;
  });
}

function parseAttributes(tag) {
  const attributes = Object.create(null);
  const content = tag.replace(/^<\/?[a-z][\w:-]*/i, "").replace(/\/?>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of content.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function hasExcludedAncestor(stack) {
  return stack.some((element) =>
    element.classes.some((className) => EXCLUDED_CLASSES.has(className))
    || element.attributes["aria-hidden"] === "true"
    || ["script", "style", "textarea", "input", "select", "option"].includes(element.tag)
    || EXCLUDED_IDS.has(element.attributes.id)
  ) || (stack.some((element) => element.classes.includes("project-credits"))
    && stack.some((element) => element.tag === "span"));
}

function canTranslateAttributes(stack) {
  return !stack.some((element) =>
    element.classes.some((className) => EXCLUDED_CLASSES.has(className))
    || ["contact-list", "plan-list", "mood-history-list", "feedback-list"].includes(element.attributes.id)
  );
}

function extractTranslationSources(html, translationCatalog = catalog) {
  const sources = new Set(translationCatalog.extraTexts);
  for (const message of Object.values(translationCatalog.needsResponses)) sources.add(message);
  sources.add(translationCatalog.urgentChatResponse);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) sources.add(decodeHtmlEntities(title[1].replace(/<[^>]*>/g, "")).trim());
  const description = html.match(/<meta\s+[^>]*name=["']description["'][^>]*>/i);
  if (description) {
    const content = parseAttributes(description[0]).content;
    if (content) sources.add(content);
  }

  const stack = [];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi) || [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (/^<\//.test(token)) {
      const closingTag = token.match(/^<\/\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
      const openIndex = stack.map((element) => element.tag).lastIndexOf(closingTag);
      if (openIndex >= 0) stack.length = openIndex;
      continue;
    }
    if (token.startsWith("<")) {
      const tag = token.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attributes = parseAttributes(token);
      const element = {
        tag,
        attributes,
        classes: (attributes.class || "").split(/\s+/).filter(Boolean)
      };
      if (canTranslateAttributes([...stack, element])) {
        for (const name of ["placeholder", "aria-label", "title"]) {
          if (attributes[name]?.trim()) sources.add(attributes[name].trim());
        }
      }
      if (!VOID_ELEMENTS.has(tag) && !/\/\s*>$/.test(token)) stack.push(element);
      continue;
    }

    if (hasExcludedAncestor(stack)) continue;
    const chatLog = stack.some((element) => element.classes.includes("chat-log"));
    const initialChatMessage = stack.some((element) => element.classes.includes("initial-chat-message"));
    if (chatLog && !initialChatMessage) continue;
    const text = decodeHtmlEntities(token).trim();
    if (text) sources.add(text);
  }

  const result = [...sources];
  if (result.some((text) => typeof text !== "string" || !text.trim())
    || result.length > MAX_TRANSLATION_ITEMS
    || result.reduce((total, text) => total + text.length, 0) > MAX_TRANSLATION_CHARACTERS) {
    throw new Error("The translation catalog is invalid or exceeds the supported request size.");
  }
  return result;
}

function isValidPack(pack, language, sourceHash, sources) {
  return pack?.language === language
    && pack.sourceHash === sourceHash
    && pack.translations
    && typeof pack.translations === "object"
    && !Array.isArray(pack.translations)
    && sources.every((source) => typeof pack.translations[source] === "string" && pack.translations[source].trim());
}

async function readPack(filePath, language, sourceHash, sources) {
  try {
    const pack = JSON.parse(await fs.readFile(filePath, "utf8"));
    return isValidPack(pack, language, sourceHash, sources) ? pack : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function samePlaceholders(source, translation) {
  const sourceTokens = source.match(PLACEHOLDER_PATTERN) || [];
  const translatedTokens = translation.match(PLACEHOLDER_PATTERN) || [];
  return sourceTokens.length === translatedTokens.length
    && sourceTokens.every((token, index) => token === translatedTokens[index]);
}

async function writeJsonAtomically(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(data)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function buildLanguagePacks({
  root = ROOT,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
  languages = Object.keys(LOCALES),
  requestDelayMs = 1000,
  rateLimitPauseMs = 61_000,
  pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
} = {}) {
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const outputDirectory = path.join(root, "language-packs");
  const filesByLanguage = new Map(languages.map((language) => [language, path.join(outputDirectory, `${language}.json`)]));
  const existingPacks = new Map();

  for (const [language, filePath] of filesByLanguage) {
    if (!Object.hasOwn(LOCALES, language)) throw new Error(`Unsupported language pack: ${language}`);
    existingPacks.set(language, await readPack(filePath, language, sourceHash, sources));
  }

  const languagesToBuild = [...filesByLanguage.keys()].filter((language) => !existingPacks.get(language));
  if (languagesToBuild.length && !apiKey) {
    throw new Error("GEMINI_API_KEY is required to generate missing or outdated language packs.");
  }
  await fs.mkdir(outputDirectory, { recursive: true });

  for (let index = 0; index < languagesToBuild.length; index += 1) {
    const language = languagesToBuild[index];
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await handleTranslationRequest({ language, texts: sources }, { apiKey, fetchImpl });
      if (result.status === 200) break;
      if (result.status === 400 || result.status === 503 || attempt === 2) {
        throw new Error(`Could not build the ${language} language pack: ${result.body.error}`);
      }
      await pause((attempt + 1) * 5000);
    }

    const translations = Object.fromEntries(sources.map((source, textIndex) => [source, result.body.translations[textIndex]]));
    const invalidToken = sources.find((source) => !samePlaceholders(source, translations[source]));
    if (invalidToken) throw new Error(`The ${language} translation changed a required placeholder in: ${invalidToken}`);

    await writeJsonAtomically(filesByLanguage.get(language), {
      language,
      sourceHash,
      translations
    });

    const completedBuilds = index + 1;
    if (requestDelayMs > 0 && completedBuilds < languagesToBuild.length) await pause(requestDelayMs);
    if (completedBuilds % 7 === 0 && completedBuilds < languagesToBuild.length) await pause(rateLimitPauseMs);
  }

  await writeJsonAtomically(path.join(outputDirectory, "manifest.json"), {
    sourceHash,
    languages: [...filesByLanguage.keys()],
    sourceCount: sources.length
  });

  return { sourceHash, sourceCount: sources.length, generatedLanguages: languagesToBuild };
}

if (require.main === module) {
  buildLanguagePacks()
    .then(({ sourceCount, generatedLanguages }) => {
      console.log(`Language packs ready (${sourceCount} interface strings). Generated ${generatedLanguages.length} pack(s).`);
    })
    .catch((error) => {
      console.error(`[language-packs] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { buildLanguagePacks, extractTranslationSources, isValidPack };
