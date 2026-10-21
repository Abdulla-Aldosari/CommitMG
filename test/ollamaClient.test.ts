// Tests for OllamaClient's native API transport: model listing via
// GET /api/tags, generation via POST /api/chat with stream:false and the
// options object, and the reply reading from message.content with
// done_reason. A local Ollama server is keyless, so no Authorization header
// is ever sent.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "mocha";
import { OllamaClient } from "../src/ai/providers/ollama";

const BASE_URL = "http://localhost:11434";

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

describe("OllamaClient native API transport", () => {
  const originalFetch = globalThis.fetch;
  let requests: RecordedRequest[];
  let nextResponse: () => Response;

  beforeEach(() => {
    requests = [];
    nextResponse = () => new Response(JSON.stringify({ models: [] }), { status: 200 });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return nextResponse();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const client = (): OllamaClient => new OllamaClient(BASE_URL, "llama3.2");

  it("listModels calls GET /api/tags and maps models[].name to model entries", async () => {
    nextResponse = () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "llama3.2", model: "llama3.2" },
            { name: "qwen2.5-coder:7b", model: "qwen2.5-coder:7b" },
          ],
        }),
        { status: 200 },
      );

    const models = await client().listModels();

    assert.deepEqual(models, [
      { modelId: "llama3.2", modelLabel: "llama3.2" },
      { modelId: "qwen2.5-coder:7b", modelLabel: "qwen2.5-coder:7b" },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BASE_URL}/api/tags`);
  });

  it("complete POSTs /api/chat with stream:false and the resolved options, and returns the trimmed message content", async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ model: "llama3.2", message: { role: "assistant", content: "  fix(a): test change\n" }, done: true, done_reason: "stop" }), { status: 200 });

    const text = await client().complete("system", "user");

    assert.equal(text, "fix(a): test change");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BASE_URL}/api/chat`);
    const body = JSON.parse(String(requests[0].init.body)) as Record<string, unknown>;
    assert.deepEqual(body, {
      model: "llama3.2",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
      stream: false,
      options: { temperature: 0.2, num_predict: 8192 },
    });
  });

  it("maps an explicit output cap to options.num_predict", async () => {
    nextResponse = () => new Response(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop" }), { status: 200 });

    await client().complete("system", "user", { params: { maxOutputTokens: 256 } });

    const body = JSON.parse(String(requests[0].init.body)) as { options: Record<string, unknown> };
    assert.equal(body.options.num_predict, 256);
  });

  it("never sends an Authorization header", async () => {
    nextResponse = () => new Response(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true, done_reason: "stop" }), { status: 200 });
    await client().complete("system", "user");
    await client().listModels();
    await client().checkConnection();

    for (const request of requests) {
      const headers = (request.init.headers ?? {}) as Record<string, string>;
      assert.equal("Authorization" in headers, false, `unexpected Authorization header for ${request.url}`);
    }
  });

  it("throws 'returned no usable content' when message.content is missing", async () => {
    nextResponse = () => new Response(JSON.stringify({ model: "llama3.2", done: true, done_reason: "stop" }), { status: 200 });

    await assert.rejects(client().complete("system", "user"), (error: Error) => {
      assert.equal(error.message, "Ollama returned no usable content (done_reason: stop)");
      return true;
    });
  });

  it("rejects a reply cut off at num_predict (done_reason length)", async () => {
    nextResponse = () => new Response(JSON.stringify({ message: { role: "assistant", content: "unfinished" }, done: true, done_reason: "length" }), { status: 200 });

    await assert.rejects(client().complete("system", "user"), (error: Error) => {
      assert.equal(error.message.includes("stopped at the output limit"), true, error.message);
      return true;
    });
  });

  it("checkConnection calls GET /api/tags and surfaces HTTP failures", async () => {
    nextResponse = () => new Response("not found", { status: 404 });

    await assert.rejects(client().checkConnection(), (error: Error) => {
      assert.equal(error.message, `HTTP 404 from ${BASE_URL}/api/tags: not found`);
      return true;
    });
  });
});
