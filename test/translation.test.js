const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkTranslationRateLimit,
  handleTranslationRequest,
  validateTranslationPayload
} = require("../translation-core.cjs");
const { handler: netlifyTranslateHandler } = require("../netlify/functions/translate.js");
const vercelTranslateHandler = require("../api/translate.js");

test("translation requests validate supported languages, text items, and size", () => {
  assert.deepEqual(validateTranslationPayload({ language: "hi", texts: ["Hello", "Good morning"] }), {
    language: "hi",
    texts: ["Hello", "Good morning"]
  });

  for (const payload of [
    { language: "en", texts: ["Hello"] },
    { language: "not-supported", texts: ["Hello"] },
    { language: "hi", texts: [] },
    { language: "hi", texts: Array(601).fill("Hello") },
    { language: "hi", texts: [12] },
    { language: "hi", texts: ["x".repeat(2001)] },
    { language: "hi", texts: ["x".repeat(30_001)] },
    { language: "hi", texts: Array(16).fill("x".repeat(2000)) }
  ]) {
    assert.equal(typeof validateTranslationPayload(payload).error, "string");
  }
});

test("translation rate limits reset after one minute", () => {
  const client = `translation-test-${Date.now()}-${Math.random()}`;
  for (let count = 0; count < 8; count += 1) {
    assert.equal(checkTranslationRateLimit(client, 1_000), true);
  }
  assert.equal(checkTranslationRateLimit(client, 1_000), false);
  assert.equal(checkTranslationRateLimit(client, 61_000), true);
});

test("translation requests preserve item order and keep the API key in a header", async () => {
  let upstreamRequest;
  const result = await handleTranslationRequest({
    language: "hi",
    texts: ["A short pause", "Call 112 if there is immediate danger."]
  }, {
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      upstreamRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: ["एक छोटा विराम", "तत्काल खतरे में 112 पर कॉल करें।"] }) }] } }]
        })
      };
    }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { language: "hi", translations: ["एक छोटा विराम", "तत्काल खतरे में 112 पर कॉल करें।"] });
  assert.equal(upstreamRequest.options.headers["x-goog-api-key"], "test-key");
  assert.equal(new URL(upstreamRequest.url).searchParams.has("key"), false);
  assert.deepEqual(JSON.parse(upstreamRequest.options.body).contents[0].parts[0].text, JSON.stringify([
    "A short pause",
    "Call 112 if there is immediate danger."
  ]));
});

test("translated output must preserve every source placeholder", async () => {
  const result = await handleTranslationRequest({
    language: "hi",
    texts: ["For {{TASK}}, choose one step."]
  }, {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: ["एक कदम चुनें।"] }) }] } }]
      })
    })
  });

  assert.equal(result.status, 502);
  assert.match(result.body.error, /incomplete text/);
});

test("missing translation API configuration gives setup guidance without a network request", async () => {
  const result = await handleTranslationRequest({ language: "hi", texts: ["Hello"] }, {
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("The API should not be called without a key.");
    }
  });

  assert.equal(result.status, 503);
  assert.match(result.body.error, /English remains available/);
});

test("translation endpoint rejects invalid methods and payloads", async () => {
  const netlifyGet = await netlifyTranslateHandler({ httpMethod: "GET", headers: {}, body: "" }, {});
  assert.equal(netlifyGet.statusCode, 405);

  const netlifyInvalid = await netlifyTranslateHandler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ language: "hi", texts: [] })
  }, { ip: `netlify-translate-${Date.now()}-${Math.random()}` });
  assert.equal(netlifyInvalid.statusCode, 400);

  const vercelGet = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
  await vercelTranslateHandler({ method: "GET", headers: {} }, vercelGet);
  assert.equal(vercelGet.statusCode, 405);
  assert.equal(vercelGet.headers.Allow, "POST");

  const vercelInvalid = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
  await vercelTranslateHandler({
    method: "POST",
    headers: { "x-vercel-forwarded-for": `vercel-translate-${Date.now()}-${Math.random()}` },
    body: { language: "hi", texts: [] }
  }, vercelInvalid);
  assert.equal(vercelInvalid.statusCode, 400);
  assert.equal(vercelInvalid.headers["Cache-Control"], "no-store");
});

test("translation endpoints allow only configured native app origins", async () => {
  const nativeOrigin = "capacitor://localhost";
  const netlifyPreflight = await netlifyTranslateHandler({
    httpMethod: "OPTIONS",
    headers: { origin: nativeOrigin }
  }, {});
  assert.equal(netlifyPreflight.statusCode, 204);
  assert.equal(netlifyPreflight.headers["Access-Control-Allow-Origin"], nativeOrigin);

  const netlifyDenied = await netlifyTranslateHandler({
    httpMethod: "OPTIONS",
    headers: { origin: "https://example.com" }
  }, {});
  assert.equal(netlifyDenied.headers["Access-Control-Allow-Origin"], undefined);

  const vercelPreflight = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; }
  };
  await vercelTranslateHandler({ method: "OPTIONS", headers: { origin: nativeOrigin } }, vercelPreflight);
  assert.equal(vercelPreflight.statusCode, 204);
  assert.equal(vercelPreflight.headers["Access-Control-Allow-Origin"], nativeOrigin);
});

test("translation endpoints report missing API configuration explicitly", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const netlifyResult = await netlifyTranslateHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ language: "hi", texts: ["Hello"] })
    }, { ip: `netlify-translate-key-${Date.now()}-${Math.random()}` });
    assert.equal(netlifyResult.statusCode, 503);
    assert.match(JSON.parse(netlifyResult.body).error, /English remains available/);

    const vercelResponse = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = body; }
    };
    await vercelTranslateHandler({
      method: "POST",
      headers: { "x-vercel-forwarded-for": `vercel-translate-key-${Date.now()}-${Math.random()}` },
      body: { language: "hi", texts: ["Hello"] }
    }, vercelResponse);
    assert.equal(vercelResponse.statusCode, 503);
    assert.match(JSON.parse(vercelResponse.body).error, /English remains available/);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
