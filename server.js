const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { MAX_REQUEST_LENGTH, checkRateLimit, handleChatRequest, nativeAppCorsHeaders } = require("./chat-core.cjs");
const { isSupportedLocale } = require("./locales.cjs");
const {
  MAX_TRANSLATION_REQUEST_LENGTH,
  checkTranslationRateLimit,
  handleTranslationRequest
} = require("./translation-core.cjs");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/translation-catalog.js", ["translation-catalog.js", "text/javascript; charset=utf-8"]],
  ["/app-config.js", ["app-config.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/downloads/mind-care.apk", [path.join("downloads", "mind-care.apk"), "application/vnd.android.package-archive"]]
]);

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...nativeAppCorsHeaders(origin)
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, maximumSize = MAX_REQUEST_LENGTH) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumSize) throw new RangeError("Request body is too large.");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/translate") {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS") {
      response.writeHead(204, nativeAppCorsHeaders(origin));
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Use POST to translate the page." }, origin);
      return;
    }

    const clientKey = request.socket.remoteAddress || "local";
    if (!checkTranslationRateLimit(clientKey)) {
      sendJson(response, 429, { error: "Too many translation requests. Please wait a minute and try again." }, origin);
      return;
    }

    try {
      const payload = await readJsonBody(request, MAX_TRANSLATION_REQUEST_LENGTH);
      const result = await handleTranslationRequest(payload);
      sendJson(response, result.status, result.body, origin);
    } catch (error) {
      if (error instanceof RangeError) {
        sendJson(response, 413, { error: "The page translation request is too large." }, origin);
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: error.message }, origin);
        return;
      }
      console.error("[server] Could not process translation request:", error.message);
      sendJson(response, 500, { error: "Something went wrong while translating the page." }, origin);
    }
    return;
  }

  if (requestUrl.pathname === "/api/chat") {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS") {
      response.writeHead(204, nativeAppCorsHeaders(origin));
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Use POST to send a chat message." }, origin);
      return;
    }

    const clientKey = request.socket.remoteAddress || "local";
    if (!checkRateLimit(clientKey)) {
      sendJson(response, 429, { error: "That’s a lot of messages in a short time. Please wait a minute and try again." }, origin);
      return;
    }

    try {
      const result = await handleChatRequest(await readJsonBody(request));
      sendJson(response, result.status, result.body, origin);
    } catch (error) {
      if (error instanceof RangeError) {
        sendJson(response, 413, { error: "That message is too long. Please shorten it and try again." }, origin);
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: error.message }, origin);
        return;
      }
      console.error("[server] Could not process chat request:", error.message);
      sendJson(response, 500, { error: "Something went wrong. Please try again later." }, origin);
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const file = publicFiles.get(pathname)
    || (/^\/language-packs\/[a-z]+\.json$/.test(pathname)
      && isSupportedLocale(path.basename(pathname, ".json"))
      ? [path.join("language-packs", path.basename(pathname)), "application/json; charset=utf-8"]
      : null);
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    if (pathname === "/downloads/mind-care.apk" && request.method === "HEAD") {
      const stat = await fs.stat(path.join(ROOT, file[0]));
      response.writeHead(200, {
        "Content-Type": file[1],
        "Content-Length": stat.size,
        "Content-Disposition": 'attachment; filename="mind-care.apk"',
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });
      response.end();
      return;
    }

    const content = await fs.readFile(path.join(ROOT, file[0]));
    response.writeHead(200, {
      "Content-Type": file[1],
      ...(pathname === "/downloads/mind-care.apk"
        ? { "Content-Disposition": 'attachment; filename="mind-care.apk"' }
        : {}),
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[server] Could not serve a public asset:", error.message);
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Could not load the page");
  }
});

server.listen(PORT, () => {
  console.log(`Mind Care is running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.log("Set GEMINI_API_KEY to enable AI chat and language translation. The wellbeing tools work without it.");
});
