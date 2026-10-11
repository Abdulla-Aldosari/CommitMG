// Tests for how GeminiClient sends the API key. The key must travel in the
// x-goog-api-key header and never in the URL: URLs end up in error messages,
// notifications, and developer session logs.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "mocha";
import { GeminiClient } from "../src/ai/providers/gemini";

const API_KEY = "test-secret-key-123";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

describe("GeminiClient API key transport", () => {
  const originalFetch = globalThis.fetch;
  let requests: RecordedRequest[];
  let nextResponse: () => Response;

  beforeEach(() => {
    requests = [];
    nextResponse = () => new Response(JSON.stringify({ models: [], candidates: [{ content: { parts: [{ text: "fix(a): b" }] } }] }), { status: 200 });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      return nextResponse();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const client = (): GeminiClient => new GeminiClient(API_KEY, "gemini-test");

  for (const [name, call] of [
    ["complete", (c: GeminiClient) => c.complete("system", "user")],
    ["listModels", (c: GeminiClient) => c.listModels()],
    ["checkConnection", (c: GeminiClient) => c.checkConnection()],
  ] as const) {
    it(`${name} sends the key in the x-goog-api-key header, not in the URL`, async () => {
      await call(client());

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url.includes(API_KEY), false, `the URL leaks the key: ${requests[0].url}`);
      assert.equal(requests[0].headers["x-goog-api-key"], API_KEY);
    });
  }

  it("never puts the key in an HTTP error message", async () => {
    nextResponse = () => new Response("<html>Bad Gateway</html>", { status: 502 });

    await assert.rejects(client().complete("system", "user"), (error: Error) => {
      assert.equal(error.message.includes(API_KEY), false, `the error leaks the key: ${error.message}`);
      return true;
    });
  });
});
