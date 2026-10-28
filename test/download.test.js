const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { publishAndroidApk } = require("../scripts/publish-android-apk.cjs");

test("APK publisher copies a built package to the website download path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-apk-"));
  const sourceApk = path.join(root, "debug.apk");
  const downloadApk = path.join(root, "downloads", "mind-care.apk");
  const apkContent = Buffer.from("test android package");
  try {
    await fs.writeFile(sourceApk, apkContent);
    const result = await publishAndroidApk({ sourceApk, downloadApk });
    assert.equal(result.size, apkContent.length);
    assert.deepEqual(await fs.readFile(downloadApk), apkContent);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("APK publisher refuses missing or empty build output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mind-care-apk-empty-"));
  const emptyApk = path.join(root, "empty.apk");
  try {
    await assert.rejects(
      publishAndroidApk({ sourceApk: path.join(root, "missing.apk"), downloadApk: path.join(root, "out.apk") }),
      /Android APK not found/
    );
    await fs.writeFile(emptyApk, "");
    await assert.rejects(
      publishAndroidApk({ sourceApk: emptyApk, downloadApk: path.join(root, "out.apk") }),
      /empty or not a file/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("download page only exposes its APK link after availability is confirmed", async () => {
  const root = path.join(__dirname, "..");
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const script = await fs.readFile(path.join(root, "script.js"), "utf8");
  const styles = await fs.readFile(path.join(root, "styles.css"), "utf8");
  const server = await fs.readFile(path.join(root, "server.js"), "utf8");
  assert.match(html, /data-screen="download"/);
  assert.match(html, /id="android-download-link"[^>]*hidden/);
  assert.match(script, /fetch\("\/downloads\/mind-care\.apk", \{ method: "HEAD"/);
  assert.match(script, /response\.status === 404/);
  assert.match(styles, /#android-download-link\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(server, /application\/vnd\.android\.package-archive/);
});
