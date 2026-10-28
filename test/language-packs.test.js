const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const {
  buildLanguagePacks,
  extractTranslationSources
} = require("../scripts/build-language-packs.cjs");

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

test("language packs are generated once, validated, and reused without an API key", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-packs-"));
  let upstreamRequests = 0;
  const fetchImpl = async (_url, options) => {
    upstreamRequests += 1;
    const request = JSON.parse(options.body);
    const sources = JSON.parse(request.contents[0].parts[0].text);
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({ translations: sources.map((source) => `Test translation ${source}`) })
            }]
          }
        }]
      })
    };
  };

  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    const build = await buildLanguagePacks({
      root,
      apiKey: "test-key",
      fetchImpl,
      languages: ["hi"],
      requestDelayMs: 0,
      rateLimitPauseMs: 0
    });
    const packPath = path.join(root, "language-packs", "hi.json");
    const pack = JSON.parse(await fs.readFile(packPath, "utf8"));
    assert.equal(pack.language, "hi");
    assert.equal(pack.sourceHash, build.sourceHash);
    assert.equal(Object.keys(pack.translations).length, build.sourceCount);
    assert.equal(pack.translations["{{COUNT}}/5000 characters"], "Test translation {{COUNT}}/5000 characters");
    assert.deepEqual(build.generatedLanguages, ["hi"]);

    const reused = await buildLanguagePacks({
      root,
      apiKey: "",
      fetchImpl,
      languages: ["hi"],
      requestDelayMs: 0,
      rateLimitPauseMs: 0
    });
    assert.deepEqual(reused.generatedLanguages, []);
    assert.equal(upstreamRequests, 1);
    assert.ok(Object.hasOwn(LOCALES, "hinglish"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("missing language packs fail the build clearly when the Gemini key is unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-packs-no-key-"));
  try {
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await assert.rejects(
      buildLanguagePacks({
        root,
        apiKey: "",
        languages: ["hi"]
      }),
      /GEMINI_API_KEY is required/
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

test("offline app shell precaches every bundled locale and does not request visitor downloads", async () => {
  const serviceWorker = await fs.readFile(path.join(__dirname, "..", "service-worker.js"), "utf8");
  const html = await fs.readFile(path.join(__dirname, "..", "index.html"), "utf8");
  const script = await fs.readFile(path.join(__dirname, "..", "script.js"), "utf8");
  for (const language of Object.keys(LOCALES)) {
    assert.ok(serviceWorker.includes(`/language-packs/${language}.json`), `${language} is pre-cached`);
  }
  assert.ok(html.includes('src="translation-catalog.js"'));
  assert.ok(html.includes('src="app-config.js"'));
  assert.ok(!html.includes("offline-language-download"));
  assert.ok(!script.includes("offline-language-download"));
  assert.ok(!script.includes("localStorage.setItem(`${LANGUAGE_STORAGE_KEY}:${language}`"));
  assert.ok(!script.includes('fetch("/api/translate"'));
});
