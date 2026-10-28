const { LOCALES, isSupportedLocale } = require("./locales.cjs");

const MAX_TRANSLATION_REQUEST_LENGTH = 48_000;
const MAX_TRANSLATION_ITEMS = 600;
const MAX_TRANSLATION_CHARACTERS = 30_000;
const MODEL = "gemini-3.6-flash";
const translationRateLimits = new Map();
const PLACEHOLDER_PATTERN = /\{\{[^{}]+\}\}/g;

function preservesPlaceholders(source, translation) {
  const sourceTokens = source.match(PLACEHOLDER_PATTERN) || [];
  const translationTokens = translation.match(PLACEHOLDER_PATTERN) || [];
  return sourceTokens.length === translationTokens.length
    && sourceTokens.every((token, index) => token === translationTokens[index]);
}

function checkTranslationRateLimit(clientKey, now = Date.now()) {
  for (const [key, limit] of translationRateLimits) {
    if (limit.expiresAt <= now) translationRateLimits.delete(key);
  }

  const current = translationRateLimits.get(clientKey);
  if (current && current.expiresAt > now && current.count >= 8) return false;
  if (!current && translationRateLimits.size >= 5000) {
    translationRateLimits.delete(translationRateLimits.keys().next().value);
  }
  if (!current || current.expiresAt <= now) {
    translationRateLimits.set(clientKey, { count: 1, expiresAt: now + 60_000 });
  } else {
    current.count += 1;
  }
  return true;
}

function validateTranslationPayload(payload) {
  if (!payload || !isSupportedLocale(payload.language) || payload.language === "en") {
    return { error: "Choose a supported language to translate the page." };
  }
  if (!Array.isArray(payload.texts) || payload.texts.length === 0 || payload.texts.length > MAX_TRANSLATION_ITEMS) {
    return { error: "The page translation request has an invalid number of text items." };
  }

  let totalCharacters = 0;
  for (const text of payload.texts) {
    if (typeof text !== "string" || text.length > 2000) {
      return { error: "A page text item is invalid or too long." };
    }
    totalCharacters += text.length;
    if (totalCharacters > MAX_TRANSLATION_CHARACTERS) {
      return { error: "The page text is too large to translate in one request." };
    }
  }

  return { language: payload.language, texts: payload.texts };
}

async function handleTranslationRequest(payload, { apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch } = {}) {
  const validation = validateTranslationPayload(payload);
  if (validation.error) return { status: 400, body: { error: validation.error } };
  if (!apiKey) {
    return { status: 503, body: { error: "Translation needs the Gemini service to be configured. English remains available." } };
  }

  const languageName = LOCALES[validation.language];
  const systemInstruction = [
    `Translate every string in the supplied JSON array into ${languageName}.`,
    validation.language === "hinglish" ? "Use natural Hindi-English Hinglish written in Latin script." : "Use the language's commonly used native script.",
    "Return exactly one translation for every input, in the same order, in a JSON object with the single property translations, an array of strings.",
    "Do not summarize, omit, add explanations, or change the meaning. Keep supportive wellbeing language gentle and non-clinical.",
    "Preserve URLs, email addresses, phone numbers, emergency numbers (including 112 and 14416), and placeholder tokens such as {{TASK}} exactly.",
    "This interface includes emergency and privacy information. Translate it faithfully; do not make a promise of confidentiality or claim the AI is professional care."
  ].join(" ");

  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(validation.texts) }] }],
        generationConfig: {
          maxOutputTokens: 12000,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { translations: { type: "ARRAY", items: { type: "STRING" } } },
            required: ["translations"]
          }
        }
      }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    console.error("[translate] Gemini request could not be completed:", error.name);
    return { status: 502, body: { error: "The translation service couldn’t be reached. English remains available." } };
  }

  if (!response.ok) {
    console.error(`[translate] Gemini returned HTTP ${response.status}.`);
    return { status: 502, body: { error: "The translation service couldn’t reply. English remains available." } };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { status: 502, body: { error: "The translation service returned an unreadable reply. English remains available." } };
  }

  const rawTranslation = data.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();

  if (!rawTranslation) {
    return { status: 502, body: { error: "The translation service returned no text. English remains available." } };
  }

  let translations;
  try {
    translations = JSON.parse(rawTranslation).translations;
  } catch {
    return { status: 502, body: { error: "The translation service returned invalid data. English remains available." } };
  }

  if (!Array.isArray(translations) || translations.length !== validation.texts.length
    || translations.some((text, index) => typeof text !== "string"
      || !text.trim()
      || text.length > 4000
      || !preservesPlaceholders(validation.texts[index], text))) {
    return { status: 502, body: { error: "The translation service returned incomplete text. English remains available." } };
  }

  return { status: 200, body: { language: validation.language, translations } };
}

module.exports = {
  MAX_TRANSLATION_CHARACTERS,
  MAX_TRANSLATION_ITEMS,
  MAX_TRANSLATION_REQUEST_LENGTH,
  checkTranslationRateLimit,
  handleTranslationRequest,
  validateTranslationPayload
};
