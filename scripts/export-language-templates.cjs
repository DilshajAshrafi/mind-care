const { exportLanguageTemplates } = require("./build-language-packs.cjs");

exportLanguageTemplates()
  .then(({ sourceCount, createdLanguages, updatedLanguages, existingLanguages }) => {
    console.log(`Translation templates contain ${sourceCount} source strings.`);
    console.log(`Created: ${createdLanguages.length}; refreshed: ${updatedLanguages.length}; already current: ${existingLanguages.length}.`);
    console.log("Have fluent speakers fill and review each language-templates/<locale>.json file, then run npm run build.");
  })
  .catch((error) => {
    console.error(`[translation-templates] ${error.message}`);
    process.exitCode = 1;
  });
