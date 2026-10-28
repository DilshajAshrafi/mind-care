const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REQUEST_LENGTH = 32000;
const MODEL = "gemini-3.6-flash";
const rateLimits = new Map();
const NATIVE_APP_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);
const { LOCALES, isSupportedLocale } = require("./locales.cjs");

const SYSTEM_INSTRUCTION = [
  "You are Mind Care, a kind, supportive wellbeing chat companion in a student-made public website.",
  "You are not a therapist, doctor, or emergency service. Never claim to diagnose, treat, or replace professional help.",
  "Listen without judgment, keep replies brief and warm, and offer at most one or two practical, optional next steps. Do not pressure people to breathe or to disclose more.",
  "Do not give medical diagnoses, medication instructions, or promises of confidentiality. Encourage speaking with a trusted person or qualified professional when appropriate.",
  "If someone may be in immediate danger or says they may hurt themselves or another person, respond with empathy, encourage them to contact local emergency services now and stay with a trusted person. In India, emergency number 112 and Tele-MANAS 14416 may help. Elsewhere, suggest findahelpline.com. Do not imply this chat can alert anyone or dispatch help."
].join(" ");

function validateMessages(payload) {
  if (!payload || !Array.isArray(payload.messages)) {
    return { error: "Send a list of chat messages to continue." };
  }

  const messages = payload.messages;
  const language = payload.language === undefined ? "en" : payload.language;
  if (typeof language !== "string" || !isSupportedLocale(language)) {
    return { error: "Choose a supported language before sending a chat message." };
  }
  if (messages.length === 0 || messages.length > MAX_MESSAGES || !messages[messages.length - 1] || messages[messages.length - 1].role !== "user") {
    return { error: "Please send a message to continue." };
  }

  const normalized = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (!message || message.role !== expectedRole || typeof message.content !== "string") {
      return { error: "This conversation could not be sent. Please start a new message." };
    }

    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      return { error: "Messages must be between 1 and 2,000 characters." };
    }
    normalized.push({ role: message.role, content });
  }

  return { messages: normalized, language };
}

function isUrgentMessage(text) {
  return /\b(i(?:'m| am) going to (?:kill|hurt) myself|i want to (?:die|end my life|kill myself)|i plan to (?:kill|hurt) myself|kill myself|suicid(?:e|al)|self[- ]harm|i want to hurt (?:myself|someone)|i(?:'m| am) going to hurt (?:myself|someone))\b/i.test(text);
}

function checkRateLimit(clientKey, now = Date.now()) {
  for (const [key, limit] of rateLimits) {
    if (limit.expiresAt <= now) rateLimits.delete(key);
  }

  const current = rateLimits.get(clientKey);
  if (current && current.expiresAt > now && current.count >= 10) return false;
  if (!current && rateLimits.size >= 5000) {
    rateLimits.delete(rateLimits.keys().next().value);
  }
  if (!current || current.expiresAt <= now) {
    rateLimits.set(clientKey, { count: 1, expiresAt: now + 60_000 });
  } else {
    current.count += 1;
  }
  return true;
}

function nativeAppCorsHeaders(origin) {
  const headers = { Vary: "Origin" };
  if (NATIVE_APP_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

async function handleChatRequest(payload, { apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch } = {}) {
  const validation = validateMessages(payload);
  if (validation.error) return { status: 400, body: { error: validation.error } };

  const latestMessage = validation.messages[validation.messages.length - 1].content;
  if (isUrgentMessage(latestMessage)) {
    return {
      status: 200,
      body: {
        urgent: true,
        reply: "I’m really sorry things feel this hard. I’m not able to keep you safe through a chat. If you or someone else may be in immediate danger, call your local emergency number now and go to someone you trust who can stay with you. In India, call 112 for emergencies or 14416 for Tele-MANAS support. If you’re elsewhere, find local support at findahelpline.com."
      }
    };
  }

  if (!apiKey) {
    return { status: 503, body: { error: "The chat service isn’t set up yet. You can still use the wellbeing tools and support links on this page." } };
  }

  const contents = validation.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const languageInstruction = validation.language === "en"
    ? "Reply in English."
    : validation.language === "hinglish"
      ? "Reply in natural Hinglish written in Latin script."
      : `Reply in ${LOCALES[validation.language]} using its commonly used native script.`;

  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_INSTRUCTION} ${languageInstruction} Preserve emergency numbers and support URLs exactly.` }] },
        contents,
        generationConfig: { maxOutputTokens: 350, temperature: 0.7 }
      }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    console.error("[chat] Gemini request could not be completed:", error.name);
    return { status: 502, body: { error: "The chat service couldn’t be reached just now. Please try again later or use the support links." } };
  }

  if (!response.ok) {
    console.error(`[chat] Gemini returned HTTP ${response.status}.`);
    return { status: 502, body: { error: "The chat service couldn’t reply just now. Please try again later or use the support links." } };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { status: 502, body: { error: "The chat service returned an unreadable reply. Please try again later." } };
  }

  const reply = data.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();

  if (!reply) {
    return { status: 502, body: { error: "The chat service didn’t return a text reply. Please try again later." } };
  }

  return { status: 200, body: { reply } };
}

module.exports = { MAX_REQUEST_LENGTH, checkRateLimit, handleChatRequest, nativeAppCorsHeaders };
