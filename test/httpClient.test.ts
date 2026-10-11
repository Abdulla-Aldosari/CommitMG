// Tests for the shared HTTP helpers. Error messages must never carry a URL
// query string: providers that authenticate through query parameters would
// otherwise leak credentials into notifications and logs.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "mocha";
import { fetchJson, fetchJsonWithResponse, redactUrl } from "../src/ai/providers/httpClient";

describe("redactUrl", () => {
  it("drops the query string and fragment", () => {
    assert.equal(redactUrl("https://api.example.com/v1/models?key=secret&page=2#top"), "https://api.example.com/v1/models");
  });

  it("drops credentials embedded in the URL", () => {
    assert.equal(redactUrl("https://user:pass@api.example.com/v1"), "https://api.example.com/v1");
  });

  it("leaves a plain URL unchanged", () => {
    assert.equal(redactUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/chat/completions");
  });

  it("returns a placeholder for an unparsable URL", () => {
    assert.equal(redactUrl("not a url ?key=secret"), "<invalid URL>");
  });
});

describe("fetchJson error messages", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async () => new Response('{ "error": { "message": "bad key" } }', { status: 401 })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const [name, call] of [
    ["fetchJson", (url: string) => fetchJson(url, { method: "GET" })],
    ["fetchJsonWithResponse", (url: string) => fetchJsonWithResponse(url, { method: "GET" })],
  ] as const) {
    it(`${name} keeps the status and body but strips the query string`, async () => {
      await assert.rejects(call("https://api.example.com/v1/models?key=secret-123"), (error: Error) => {
        assert.equal(error.message, 'HTTP 401 from https://api.example.com/v1/models: { "error": { "message": "bad key" } }');
        return true;
      });
    });
  }
});
