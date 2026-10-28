const {
  MAX_TRANSLATION_REQUEST_LENGTH,
  checkTranslationRateLimit,
  handleTranslationRequest
} = require("../../translation-core.cjs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { Allow: "POST" },
      body: JSON.stringify({ error: "Use POST to translate the page." })
    };
  }

  const body = event.body || "";
  if (Buffer.byteLength(body, "utf8") > MAX_TRANSLATION_REQUEST_LENGTH) {
    return { statusCode: 413, body: JSON.stringify({ error: "The page translation request is too large." }) };
  }

  const clientIp = context.ip || event.headers?.["x-nf-client-connection-ip"] || "unknown";
  if (!checkTranslationRateLimit(clientIp)) {
    return { statusCode: 429, body: JSON.stringify({ error: "Too many translation requests. Please wait a minute and try again." }) };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Request body must be valid JSON." }) };
  }

  const result = await handleTranslationRequest(payload);
  return {
    statusCode: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(result.body)
  };
};
