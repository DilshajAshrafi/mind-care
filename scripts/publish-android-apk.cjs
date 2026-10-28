const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_APK = path.join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const DOWNLOAD_APK = path.join(ROOT, "downloads", "mind-care.apk");

async function publishAndroidApk({
  sourceApk = SOURCE_APK,
  downloadApk = DOWNLOAD_APK
} = {}) {
  const stat = await fs.stat(sourceApk).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`Android APK not found at ${sourceApk}. Build the Android app before publishing it.`);
    }
    throw error;
  });
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Android APK is empty or not a file: ${sourceApk}`);
  }

  await fs.mkdir(path.dirname(downloadApk), { recursive: true });
  await fs.copyFile(sourceApk, downloadApk);
  return { downloadApk, size: stat.size };
}

if (require.main === module) {
  publishAndroidApk()
    .then(({ downloadApk, size }) => {
      console.log(`Android APK ready for the website at ${downloadApk} (${size} bytes).`);
    })
    .catch((error) => {
      console.error(`[android-publish] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { publishAndroidApk };
