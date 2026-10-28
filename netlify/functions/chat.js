const { MAX_REQUEST_LENGTH, checkRateLimit, handleChatRequest, nativeAppCorsHeaders } = require("../../chat-core.cjs");

exports.handler = async (event, context) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const corsHeaders = nativeAppCorsHeaders(origin);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, Allow: "POST", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Use POST to send a chat message." })
    };
  }

  const body = event.body || "";
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_LENGTH) {
    return {
      statusCode: 413,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "That message is too long. Please shorten it and try again." })
    };
  }

  const clientIp = context.ip || event.headers?.["x-nf-client-connection-ip"] || "unknown";
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "That’s a lot of messages in a short time. Please wait a minute and try again." })
    };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Request body must be valid JSON." })
    };
  }

  const result = await handleChatRequest(payload);
  return {
    statusCode: result.status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(result.body)
  };
};
