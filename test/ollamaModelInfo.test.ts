// Tests for measuring a local Ollama model from its own /api/show metadata
// and transcribing it into a stored capability profile.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "mocha";
import { fetchOllamaModelInfo, profileFromOllamaModelInfo, type OllamaModelInfo } from "../src/dev/probe/ollamaModelInfo";

const profile = (info: OllamaModelInfo) => profileFromOllamaModelInfo("qwen2.5-coder:32b", info) as NonNullable<ReturnType<typeof profileFromOllamaModelInfo>>;

describe("profileFromOllamaModelInfo", () => {
  it("records temperature and the output cap even without thinking metadata", () => {
    const result = profile({ capabilities: ["completion"] });
    assert.equal(result.id, "ollama-measured");
    assert.deepEqual(result.reasoning, { control: "none", levels: {}, onByDefault: false });
    assert.equal(result.temperature, "supported");
    assert.equal(result.outputCapField, "max_tokens");
  });

  it("treats values [false] as no thinking support", () => {
    const result = profile({ thinking: { values: [false], default: false } });
    assert.equal(result.reasoning.control, "none");
  });

  it("maps boolean on/off controls to off/low think values", () => {
    const result = profile({ thinking: { values: [true, false], default: true } });
    assert.deepEqual(result.reasoning, { control: "think", levels: { off: false, low: true }, onByDefault: true });
  });

  it("maps model-defined level names to the neutral levels they name", () => {
    const result = profile({ thinking: { values: ["low", "medium", "high"], default: "medium" } });
    assert.deepEqual(result.reasoning, { control: "think", levels: { low: "low", medium: "medium", high: "high" }, onByDefault: true });
  });

  it("combines a boolean off with named levels", () => {
    const result = profile({ thinking: { values: [false, "low", "high"], default: false } });
    assert.deepEqual(result.reasoning, { control: "think", levels: { off: false, low: "low", high: "high" }, onByDefault: false });
  });

  it("returns null for a non-object payload", () => {
    assert.equal(profileFromOllamaModelInfo("m", null as unknown as OllamaModelInfo), null);
  });
});

describe("fetchOllamaModelInfo", () => {
  const originalFetch = globalThis.fetch;
  let requests: Array<{ url: string; body: string }>;

  beforeEach(() => {
    requests = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ capabilities: ["completion", "thinking"], thinking: { values: [true, false], default: false } }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs /api/show with the model name and parses the metadata", async () => {
    const info = await fetchOllamaModelInfo("http://localhost:11434", "qwen2.5-coder:32b");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://localhost:11434/api/show");
    assert.equal(JSON.parse(requests[0].body).model, "qwen2.5-coder:32b");
    assert.deepEqual(info.thinking, { values: [true, false], default: false });
  });
});
