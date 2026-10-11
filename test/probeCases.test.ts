// Tests for the developer capability probe's request matrix. Pure: no
// request is sent.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { buildProbeRequest, capProbeCases, deepMerge, featureProbeCases, requestsPerModel, wireFormatFor, type ProbeTarget } from "../src/dev/probe/probeCases";

const KEY = "probe-secret-key-123";

const target = (providerName: ProbeTarget["providerName"], baseUrl = "https://api.example.com/v1"): ProbeTarget => ({
  providerName,
  wireFormat: wireFormatFor(providerName),
  baseUrl,
  apiKey: KEY,
});

const bodyOf = (request: { init: { body: string } }): Record<string, unknown> => JSON.parse(request.init.body) as Record<string, unknown>;

describe("probe request matrix", () => {
  it("maps every provider to its wire format", () => {
    assert.equal(wireFormatFor("gemini"), "gemini");
    assert.equal(wireFormatFor("anthropic"), "anthropic");
    assert.equal(wireFormatFor("mistral"), "mistral");
    assert.equal(wireFormatFor("cohere"), "cohere");
    for (const name of ["openai", "deepseek", "groq", "stepfun", "custom"] as const) {
      assert.equal(wireFormatFor(name), "openai-chat");
    }
  });

  it("tests both output cap fields only for the OpenAI-style format", () => {
    assert.deepEqual(
      capProbeCases("openai-chat").map((entry) => entry.capField),
      ["max_tokens", "max_completion_tokens"],
    );
    assert.equal(capProbeCases("anthropic").length, 1);
  });

  it("puts the chosen cap field in the OpenAI-style body", () => {
    const [, { probeCase }] = capProbeCases("openai-chat");
    const body = bodyOf(buildProbeRequest(target("openai"), "gpt-x", probeCase, "max_completion_tokens"));
    assert.equal(body.max_completion_tokens, 16);
    assert.equal("max_tokens" in body, false);
  });

  it("adds the provider-specific cases only where they apply", () => {
    const ids = (name: ProbeTarget["providerName"]): string[] => featureProbeCases(target(name)).map((probeCase) => probeCase.id);
    assert.ok(ids("deepseek").includes("thinking-disabled"));
    assert.ok(!ids("openai").includes("thinking-disabled"));
    assert.ok(ids("groq").includes("reasoning-format-hidden"));
    assert.ok(ids("gemini").includes("thinking-level-and-budget"));
    assert.ok(ids("anthropic").includes("thinking-adaptive-temperature"));
  });

  it("merges a Gemini thinking patch into generationConfig without dropping the output cap", () => {
    const probeCase = featureProbeCases(target("gemini")).find((entry) => entry.id === "thinking-level-low");
    assert.ok(probeCase);
    const request = buildProbeRequest(target("gemini"), "gemini-x", probeCase, "max_tokens");
    assert.deepEqual(bodyOf(request).generationConfig, { maxOutputTokens: 16, thinkingConfig: { thinkingLevel: "low" } });
    assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
  });

  it("gives thinking-budget cases room above the budget", () => {
    const probeCase = featureProbeCases(target("anthropic")).find((entry) => entry.id === "thinking-enabled-budget");
    assert.ok(probeCase);
    const body = bodyOf(buildProbeRequest(target("anthropic"), "claude-x", probeCase, "max_tokens"));
    assert.ok((body.max_tokens as number) > 1024);
  });

  it("sends the API key only in a header, never in the URL or body", () => {
    for (const name of ["openai", "gemini", "anthropic", "mistral", "cohere"] as const) {
      for (const probeCase of featureProbeCases(target(name))) {
        const request = buildProbeRequest(target(name), "model-x", probeCase, "max_tokens");
        assert.equal(request.url.includes(KEY), false);
        assert.equal(request.init.body.includes(KEY), false);
        assert.ok(Object.values(request.init.headers).some((value) => value.includes(KEY)));
      }
    }
  });

  it("omits the Authorization header for a keyless custom endpoint", () => {
    const keyless: ProbeTarget = { ...target("custom", "http://localhost:11434/v1"), apiKey: "" };
    const request = buildProbeRequest(keyless, "llama", capProbeCases("openai-chat")[0].probeCase, "max_tokens");
    assert.equal("Authorization" in request.init.headers, false);
    assert.equal(request.url, "http://localhost:11434/v1/chat/completions");
  });

  it("counts the requests one model costs", () => {
    assert.equal(requestsPerModel(target("openai")), capProbeCases("openai-chat").length + featureProbeCases(target("openai")).length);
  });

  it("deep-merges nested objects and removes undefined keys", () => {
    assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 9 }, d: undefined }), { a: { b: 1, c: 9 } });
  });
});
