const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const {
  buildLanguagePacks,
  exportLanguageTemplates,
  extractTranslationSources,
  setBundledLanguagePacks
} = require("../scripts/build-language-packs.cjs");
const { prepareOnlineBuild } = require("../scripts/prepare-online-build.cjs");
const { generateLanguagePacksOnline } = require("../scripts/generate-language-packs-online.cjs");

test("build catalog includes page content, accessibility labels, and app messages", async () => {
  const html = await fs.readFile(path.join(__dirname, "..", "index.html"), "utf8");
  const sources = extractTranslationSources(html);
  assert.ok(sources.length > 200);
  assert.ok(sources.length <= 600);
  assert.ok(sources.includes("Mind Care — a student-made wellbeing space"));
  assert.ok(sources.includes("Languages, online and offline"));
  assert.ok(sources.includes("Breathe in"));
  assert.ok(!sources.includes("Page language"));
  assert.ok(!sources.includes("Download all languages for offline use"));
  assert.equal(new Set(sources).size, sources.length);
});

test("all locale templates, language options, and offline entries match the current catalog", async () => {
  const root = path.join(__dirname, "..");
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const serviceWorker = await fs.readFile(path.join(root, "service-worker.js"), "utf8");
  const appConfig = await fs.readFile(path.join(root, "app-config.js"), "utf8");
  const sources = extractTranslationSources(html);
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const expectedLanguages = Object.keys(LOCALES).sort();
  const optionLanguages = [...html.matchAll(/<option value="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((language) => language !== "en")
    .sort();

  assert.deepEqual(optionLanguages, expectedLanguages);
  assert.match(appConfig, /bundledLanguagePacks:\s*false/);
  for (const language of expectedLanguages) {
    assert.ok(serviceWorker.includes(`/language-packs/${language}.json`), `${language} is offline-cached`);
    const template = JSON.parse(await fs.readFile(
      path.join(root, "language-templates", `${language}.json`),
      "utf8"
    ));
    assert.equal(template.language, language);
    assert.equal(template.sourceHash, sourceHash, `${language} template is current`);
    assert.deepEqual(Object.keys(template.translations).sort(), [...sources].sort(), `${language} covers every source`);
    for (const source of sources) {
      const translation = template.translations[source];
      assert.equal(typeof translation, "string", `${language} has a string entry for "${source}"`);
      if (!translation.trim()) continue;
      assert.deepEqual(
        translation.match(/\{\{[^{}]+\}\}/g) || [],
        source.match(/\{\{[^{}]+\}\}/g) || [],
        `${language} preserves placeholders for "${source}"`
      );
    }
  }
});

test("manual language packs are validated and reused without calling a translation service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-packs-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    const exported = await exportLanguageTemplates({ root, languages: ["hi"] });
    const templatePath = path.join(root, "language-templates", "hi.json");
    const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
    template.translations = Object.fromEntries(
      Object.keys(template.translations).map((source) => [source, `Test translation ${source}`])
    );
    await fs.writeFile(templatePath, JSON.stringify(template));
    const build = await buildLanguagePacks({ root, languages: ["hi"] });
    const packPath = path.join(root, "language-packs", "hi.json");
    const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
    assert.equal(pack.language, "hi");
    assert.equal(pack.sourceHash, build.sourceHash);
    assert.equal(Object.keys(pack.translations).length, build.sourceCount);
    assert.equal(pack.translations["{{COUNT}}/5000 characters"], "Test translation {{COUNT}}/5000 characters");
    assert.deepEqual(exported.createdLanguages, ["hi"]);
    assert.deepEqual(build.generatedLanguages, ["hi"]);

    const reused = await buildLanguagePacks({ root, languages: ["hi"] });
    assert.deepEqual(reused.generatedLanguages, []);
    assert.ok(Object.hasOwn(LOCALES, "hinglish"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("manual template refresh preserves reviewed strings and adds new source strings blank", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-template-refresh-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await exportLanguageTemplates({ root, languages: ["hi"] });
    const templatePath = path.join(root, "language-templates", "hi.json");
    const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
    const [reviewedSource] = Object.keys(template.translations);
    template.translations[reviewedSource] = "Reviewed translation";
    await fs.writeFile(templatePath, JSON.stringify(template));
    await fs.appendFile(path.join(root, "index.html"), "\n<p>A new source string.</p>\n");

    const refreshed = await exportLanguageTemplates({ root, languages: ["hi"] });
    const result = JSON.parse(await fs.readFile(templatePath, "utf8"));
    assert.deepEqual(refreshed.updatedLanguages, ["hi"]);
    assert.equal(result.translations[reviewedSource], "Reviewed translation");
    assert.equal(result.translations["A new source string."], "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("template export does not overwrite a damaged translation file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-template-corrupt-"));
  const templatePath = path.join(root, "language-templates", "hi.json");
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await fs.mkdir(path.dirname(templatePath));
    await fs.writeFile(templatePath, "{ invalid JSON");
    await assert.rejects(exportLanguageTemplates({ root, languages: ["hi"] }), SyntaxError);
    assert.equal(await fs.readFile(templatePath, "utf8"), "{ invalid JSON");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("manual language packs fail explicitly when templates or translations are missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-packs-incomplete-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await assert.rejects(
      buildLanguagePacks({ root, languages: ["hi"] }),
      /Manual translations are incomplete: hi \(template is missing\)/
    );
    await exportLanguageTemplates({ root, languages: ["hi"] });
    await assert.rejects(
      buildLanguagePacks({ root, languages: ["hi"] }),
      /untranslated source string/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("manual translation placeholders must be preserved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-placeholder-check-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await exportLanguageTemplates({ root, languages: ["hi"] });
    const templatePath = path.join(root, "language-templates", "hi.json");
    const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
    template.translations = Object.fromEntries(
      Object.keys(template.translations).map((source) => [source, source])
    );
    template.translations["{{COUNT}}/5000 characters"] = "5000 characters";
    await fs.writeFile(templatePath, JSON.stringify(template));
    await assert.rejects(
      buildLanguagePacks({ root, languages: ["hi"] }),
      /placeholder mismatch/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("build catalog hash changes when the interface strings change", () => {
  const firstCatalog = extractTranslationSources("<title>Mind Care</title><body><p>First line</p></body>");
  const secondCatalog = extractTranslationSources("<title>Mind Care</title><body><p>Second line</p></body>");
  const hash = (sources) => crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  assert.notEqual(hash(firstCatalog), hash(secondCatalog));
});

test("language-pack build flag preserves the backend URL and only enables after packaging", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-pack-config-"));
  const configPath = path.join(root, "app-config.js");
  try {
    await fs.writeFile(
      configPath,
      'globalThis.MIND_CARE_APP_CONFIG = Object.freeze({ chatApiBaseUrl: "https://api.example" });\n'
    );
    await setBundledLanguagePacks(false, root);
    let config = await fs.readFile(configPath, "utf8");
    assert.match(config, /bundledLanguagePacks: false/);
    assert.match(config, /https:\/\/api\.example/);

    await setBundledLanguagePacks(true, root);
    config = await fs.readFile(configPath, "utf8");
    assert.match(config, /bundledLanguagePacks: true/);
    assert.match(config, /https:\/\/api\.example/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("online website build does not require offline language pack files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-online-build-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await fs.writeFile(
      path.join(root, "app-config.js"),
      'globalThis.MIND_CARE_APP_CONFIG = Object.freeze({ chatApiBaseUrl: "", bundledLanguagePacks: true });\n'
    );
    const result = await prepareOnlineBuild({ root });
    const config = await fs.readFile(path.join(root, "app-config.js"), "utf8");
    assert.equal(result.languageCount, 23);
    assert.ok(result.sourceCount > 300);
    assert.equal(result.bundledLanguagePacks, false);
    assert.match(config, /bundledLanguagePacks: false/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("online pack generator validates and bundles every locale for offline builds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-generated-packs-"));
  const projectRoot = path.join(__dirname, "..");
  let requestCount = 0;
  try {
    await fs.copyFile(path.join(projectRoot, "index.html"), path.join(root, "index.html"));
    await fs.copyFile(path.join(projectRoot, "app-config.js"), path.join(root, "app-config.js"));
    const result = await generateLanguagePacksOnline({
      root,
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        requestCount += 1;
        assert.match(url, /generativelanguage\.googleapis\.com/);
        assert.equal(options.headers["x-goog-api-key"], "test-key");
        const sourceStrings = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{ text: JSON.stringify({ translations: sourceStrings.map((source) => `Test ${source}`) }) }]
              }
            }]
          })
        };
      }
    });

    assert.equal(requestCount, Object.keys(LOCALES).length);
    assert.equal(result.generatedLanguages.length, Object.keys(LOCALES).length);
    assert.equal(result.sourceCount, extractTranslationSources(await fs.readFile(path.join(root, "index.html"), "utf8")).length);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "language-packs", "manifest.json"), "utf8"));
    assert.equal(manifest.languages.length, 23);
    assert.equal(manifest.sourceCount, result.sourceCount);
    const config = await fs.readFile(path.join(root, "app-config.js"), "utf8");
    assert.match(config, /bundledLanguagePacks: true/);

    const prepared = await prepareOnlineBuild({ root });
    assert.equal(prepared.bundledLanguagePacks, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("online pack generation requires a private API key", async () => {
  await assert.rejects(
    generateLanguagePacksOnline({ apiKey: "" }),
    /Set GEMINI_API_KEY privately/
  );
});

test("offline app shell precaches every bundled locale and does not request visitor downloads", async () => {
  const serviceWorker = await fs.readFile(path.join(__dirname, "..", "service-worker.js"), "utf8");
  const html = await fs.readFile(path.join(__dirname, "..", "index.html"), "utf8");
  const script = await fs.readFile(path.join(__dirname, "..", "script.js"), "utf8");
  const appConfig = await fs.readFile(path.join(__dirname, "..", "app-config.js"), "utf8");
  const shellDefinition = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "";
  for (const language of Object.keys(LOCALES)) {
    assert.ok(serviceWorker.includes(`/language-packs/${language}.json`), `${language} is pre-cached`);
  }
  assert.ok(!shellDefinition.includes("/language-packs/"), "missing optional packs cannot block shell installation");
  assert.match(serviceWorker, /await cache\.add\(url\)/, "available packs are cached independently");
  assert.match(serviceWorker, /await cache\.put\(event\.request, response\.clone\(\)\)/, "fetched assets are cached for offline use");
  assert.ok(html.includes('src="translation-catalog.js"'));
  assert.ok(html.includes('src="app-config.js"'));
  assert.ok(!html.includes("offline-language-download"));
  assert.ok(!script.includes("offline-language-download"));
  assert.ok(!script.includes("localStorage.setItem(`${LANGUAGE_STORAGE_KEY}:${language}`"));
  assert.ok(!script.includes('fetch("/api/translate"'));
  assert.ok(script.includes("fetch(endpoint"));
  assert.ok(script.includes("openTranslationCache"));
  assert.ok(script.includes("bundledLanguagePacks"));
  const builder = await fs.readFile(path.join(__dirname, "..", "scripts", "build-language-packs.cjs"), "utf8");
  assert.ok(!builder.includes("handleTranslationRequest"));
});
