const {
  MAX_TRANSLATION_REQUEST_LENGTH,
  checkTranslationRateLimit,
  handleTranslationRequest
} = require("../translation-core.cjs");
const { nativeAppCorsHeaders } = require("../chat-core.cjs");

function sendJson(response, status, body, origin) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(nativeAppCorsHeaders(origin))) {
    response.setHeader(name, value);
  }
  response.end(JSON.stringify(body));
}

function readPayload(request) {
  const body = request.body;
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : body;
    if (Buffer.byteLength(rawBody, "utf8") > MAX_TRANSLATION_REQUEST_LENGTH) {
      return { error: "The page translation request is too large.", status: 413 };
    }
    try {
      return { payload: JSON.parse(rawBody) };
    } catch {
      return { error: "Request body must be valid JSON.", status: 400 };
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object.", status: 400 };
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_TRANSLATION_REQUEST_LENGTH) {
    return { error: "The page translation request is too large.", status: 413 };
  }
  return { payload: body };
}

async function handler(request, response) {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    for (const [name, value] of Object.entries(nativeAppCorsHeaders(origin))) {
      response.setHeader(name, value);
    }
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Use POST to translate the page." }, origin);
    return;
  }

  const forwardedIp = request.headers["x-vercel-forwarded-for"] || request.headers["x-forwarded-for"];
  const clientIp = typeof forwardedIp === "string"
    ? forwardedIp.split(",")[0].trim()
    : request.socket?.remoteAddress || "unknown";
  if (!checkTranslationRateLimit(clientIp)) {
    sendJson(response, 429, { error: "Too many translation requests. Please wait a minute and try again." }, origin);
    return;
  }

  const parsed = readPayload(request);
  if (parsed.error) {
    sendJson(response, parsed.status, { error: parsed.error }, origin);
    return;
  }

  try {
    const result = await handleTranslationRequest(parsed.payload);
    sendJson(response, result.status, result.body, origin);
  } catch (error) {
    console.error("[vercel-translate] Could not process translation request:", error.message);
    sendJson(response, 500, { error: "Something went wrong while translating the page." }, origin);
  }
}

module.exports = handler;
module.exports.readPayload = readPayload;
