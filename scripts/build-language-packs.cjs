const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const catalog = require("../translation-catalog.js");
const {
  MAX_TRANSLATION_CHARACTERS,
  MAX_TRANSLATION_ITEMS
} = require("../translation-core.cjs");

const ROOT = path.resolve(__dirname, "..");
const PACK_DIRECTORY = path.join(ROOT, "language-packs");
const TEMPLATE_DIRECTORY = path.join(ROOT, "language-templates");
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
    && sources.every((source) => typeof pack.translations[source] === "string"
      && pack.translations[source].trim()
      && samePlaceholders(source, pack.translations[source]));
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

function getCatalog(root) {
  return fs.readFile(path.join(root, "index.html"), "utf8")
    .then((html) => {
      const sources = extractTranslationSources(html);
      return {
        sources,
        sourceHash: crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex")
      };
    });
}

async function exportLanguageTemplates({ root = ROOT, languages = Object.keys(LOCALES) } = {}) {
  const { sources, sourceHash } = await getCatalog(root);
  const templateDirectory = path.join(root, "language-templates");
  await fs.mkdir(templateDirectory, { recursive: true });
  const createdLanguages = [];
  const updatedLanguages = [];
  const existingLanguages = [];

  for (const language of languages) {
    if (!Object.hasOwn(LOCALES, language)) throw new Error(`Unsupported language template: ${language}`);
    const templatePath = path.join(templateDirectory, `${language}.json`);
    let previousTemplate = null;
    try {
      previousTemplate = JSON.parse(await fs.readFile(templatePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (previousTemplate) {
      if (previousTemplate.language !== language || !previousTemplate.translations
        || typeof previousTemplate.translations !== "object" || Array.isArray(previousTemplate.translations)) {
        throw new Error(`Cannot safely update the ${language} template because its structure is invalid.`);
      }
      if (previousTemplate.sourceHash === sourceHash) {
        existingLanguages.push(language);
        continue;
      }
      const translations = Object.fromEntries(sources.map((source) => [
        source,
        typeof previousTemplate.translations[source] === "string" ? previousTemplate.translations[source] : ""
      ]));
      await writeJsonAtomically(templatePath, { language, sourceHash, translations });
      updatedLanguages.push(language);
      continue;
    }

    await writeJsonAtomically(templatePath, {
      language,
      sourceHash,
      translations: Object.fromEntries(sources.map((source) => [source, ""]))
    });
    createdLanguages.push(language);
  }

  return { sourceHash, sourceCount: sources.length, createdLanguages, updatedLanguages, existingLanguages };
}

async function readManualTemplate(templatePath, language, sourceHash, sources) {
  let template;
  try {
    template = JSON.parse(await fs.readFile(templatePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { error: "template is missing" };
    if (error instanceof SyntaxError) return { error: "template is not valid JSON" };
    throw error;
  }

  if (template.language !== language) return { error: "language code does not match the template filename" };
  if (template.sourceHash !== sourceHash) return { error: "template is outdated; export a new template and merge reviewed translations" };
  if (!template.translations || typeof template.translations !== "object" || Array.isArray(template.translations)) {
    return { error: "translations must be an object keyed by the exact English source strings" };
  }

  const missing = sources.filter((source) =>
    typeof template.translations[source] !== "string" || !template.translations[source].trim()
  );
  const invalidPlaceholder = sources.find((source) => typeof template.translations[source] === "string"
    && template.translations[source].trim()
    && !samePlaceholders(source, template.translations[source]));
  const unexpected = Object.keys(template.translations).filter((source) => !sources.includes(source));
  if (missing.length || invalidPlaceholder || unexpected.length) {
    const details = [];
    if (missing.length) details.push(`${missing.length} untranslated source string(s)`);
    if (invalidPlaceholder) details.push(`placeholder mismatch in "${invalidPlaceholder}"`);
    if (unexpected.length) details.push(`${unexpected.length} unknown source key(s)`);
    return { error: details.join(", ") };
  }

  return { translations: template.translations };
}

async function buildLanguagePacks({ root = ROOT, languages = Object.keys(LOCALES) } = {}) {
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const outputDirectory = path.join(root, "language-packs");
  const manualTemplates = new Map();

  for (const language of languages) {
    if (!Object.hasOwn(LOCALES, language)) throw new Error(`Unsupported language pack: ${language}`);
    const result = await readManualTemplate(
      path.join(root, "language-templates", `${language}.json`),
      language,
      sourceHash,
      sources
    );
    if (result.error) manualTemplates.set(language, { error: result.error });
    else manualTemplates.set(language, result);
  }

  const invalidLanguages = [...manualTemplates]
    .filter(([, result]) => result.error)
    .map(([language, result]) => `${language} (${result.error})`);
  if (invalidLanguages.length) {
    throw new Error(`Manual translations are incomplete: ${invalidLanguages.join("; ")}. Run npm run translations:templates to create or refresh templates, then complete each listed translation.`);
  }
  await fs.mkdir(outputDirectory, { recursive: true });

  const generatedLanguages = [];
  for (const language of languages) {
    const packPath = path.join(outputDirectory, `${language}.json`);
    const existingPack = await readPack(packPath, language, sourceHash, sources);
    if (existingPack) continue;

    await writeJsonAtomically(packPath, {
      language,
      sourceHash,
      translations: manualTemplates.get(language).translations
    });
    generatedLanguages.push(language);
  }

  await writeJsonAtomically(path.join(outputDirectory, "manifest.json"), {
    sourceHash,
    languages: [...languages],
    sourceCount: sources.length
  });

  return { sourceHash, sourceCount: sources.length, generatedLanguages };
}

async function setBundledLanguagePacks(enabled, root = ROOT) {
  const configPath = path.join(root, "app-config.js");
  const config = await fs.readFile(configPath, "utf8");
  const flagPattern = /bundledLanguagePacks:\s*(?:true|false)/;
  const updated = flagPattern.test(config)
    ? config.replace(flagPattern, `bundledLanguagePacks: ${enabled}`)
    : config.replace(
      /(chatApiBaseUrl:\s*"(?:\\.|[^"])*")/,
      `$1,\n  bundledLanguagePacks: ${enabled}`
    );
  if (updated === config && !flagPattern.test(config)) {
    throw new Error("Could not update the bundled-language configuration in app-config.js.");
  }
  await fs.writeFile(configPath, updated, "utf8");
}

if (require.main === module) {
  setBundledLanguagePacks(false)
    .then(() => buildLanguagePacks())
    .then(async (result) => {
      await setBundledLanguagePacks(true);
      return result;
    })
    .then(({ sourceCount, generatedLanguages }) => {
      console.log(`Manually translated language packs ready (${sourceCount} interface strings, ${generatedLanguages.length} locales).`);
    })
    .catch((error) => {
      console.error(`[language-packs] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildLanguagePacks,
  exportLanguageTemplates,
  extractTranslationSources,
  isValidPack,
  setBundledLanguagePacks
};
