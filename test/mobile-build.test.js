const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LOCALES } = require("../locales.cjs");
const { extractTranslationSources } = require("../scripts/build-language-packs.cjs");
const { assertApiBaseUrl, prepareMobile } = require("../scripts/prepare-mobile.cjs");

test("mobile chat API configuration accepts only an HTTPS base URL", () => {
  assert.equal(assertApiBaseUrl("https://mind-care.example/"), "https://mind-care.example");
  for (const invalid of ["", "http://mind-care.example", "https://user:pass@example.com", "https://example.com/?key=secret"]) {
    assert.throws(() => assertApiBaseUrl(invalid), /HTTPS URL/);
  }
});

test("Android app enables internet for chat and disables automatic backup of wellbeing data", async () => {
  const manifest = await fs.readFile(
    path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml"),
    "utf8"
  );
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android\.permission\.INTERNET/);
});

test("mobile preparation refuses to package missing language packs or API configuration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-mobile-incomplete-"));
  try {
    await assert.rejects(prepareMobile({ root, outputDirectory: path.join(root, "dist"), apiBaseUrl: "" }), /MIND_CARE_API_BASE_URL/);
    await fs.copyFile(path.join(__dirname, "..", "index.html"), path.join(root, "index.html"));
    await assert.rejects(
      prepareMobile({ root, outputDirectory: path.join(root, "dist"), apiBaseUrl: "https://mind-care.example" }),
      /language-pack manifest/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("mobile preparation packages every current locale and the configured chat backend", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-mobile-complete-"));
  const outputDirectory = path.join(root, "dist");
  const projectRoot = path.join(__dirname, "..");
  const assets = ["index.html", "styles.css", "script.js", "translation-catalog.js", "app-config.js", "favicon.svg", "manifest.webmanifest", "service-worker.js"];
  try {
    for (const asset of assets) await fs.copyFile(path.join(projectRoot, asset), path.join(root, asset));
    const sources = extractTranslationSources(await fs.readFile(path.join(root, "index.html"), "utf8"));
    const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
    const packDirectory = path.join(root, "language-packs");
    await fs.mkdir(packDirectory);
    for (const language of Object.keys(LOCALES)) {
      await fs.writeFile(
        path.join(packDirectory, `${language}.json`),
        JSON.stringify({ language, sourceHash, translations: Object.fromEntries(sources.map((source) => [source, source])) })
      );
    }
    await fs.writeFile(
      path.join(packDirectory, "manifest.json"),
      JSON.stringify({ sourceHash, sourceCount: sources.length, languages: Object.keys(LOCALES) })
    );

    const result = await prepareMobile({
      root,
      outputDirectory,
      apiBaseUrl: "https://mind-care.example"
    });
    assert.equal(result.languages.length, 23);
    assert.equal(JSON.parse(await fs.readFile(path.join(outputDirectory, "language-packs", "hi.json"), "utf8")).language, "hi");
    const appConfig = await fs.readFile(path.join(outputDirectory, "app-config.js"), "utf8");
    assert.match(appConfig, /https:\/\/mind-care\.example/);
    assert.match(appConfig, /bundledLanguagePacks: true/);
    assert.equal(
      await fs.readFile(path.join(outputDirectory, "index.html"), "utf8"),
      await fs.readFile(path.join(root, "index.html"), "utf8")
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("online mobile preparation works without language packs and configures online fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-mobile-online-"));
  const outputDirectory = path.join(root, "dist");
  const projectRoot = path.join(__dirname, "..");
  const assets = ["index.html", "styles.css", "script.js", "translation-catalog.js", "app-config.js", "favicon.svg", "manifest.webmanifest", "service-worker.js"];
  try {
    for (const asset of assets) await fs.copyFile(path.join(projectRoot, asset), path.join(root, asset));

    const result = await prepareMobile({
      root,
      outputDirectory,
      apiBaseUrl: "https://mind-care.example",
      requireBundledPacks: false
    });
    const appConfig = await fs.readFile(path.join(outputDirectory, "app-config.js"), "utf8");
    assert.equal(result.languages.length, 23);
    assert.equal(result.bundledPacks, false);
    assert.match(appConfig, /chatApiBaseUrl: "https:\/\/mind-care\.example"/);
    assert.match(appConfig, /bundledLanguagePacks: false/);
    await assert.rejects(fs.access(path.join(outputDirectory, "language-packs")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
