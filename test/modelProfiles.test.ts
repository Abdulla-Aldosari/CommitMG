// Tests for model capability profiles and the neutral-to-request parameter
// resolution. Pure; the expected values come from the capability probe.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import type { GenerationParams } from "../src/ai/params/generationParams";
import { resolveParams, type ModelProfile } from "../src/ai/params/modelProfile";
import { resolveModelProfile, resolveRequestParams } from "../src/ai/params/profileRules";

const profileOf = (provider: Parameters<typeof resolveModelProfile>[0], modelId: string): string => resolveModelProfile(provider, modelId).id;

describe("resolveModelProfile", () => {
  it("matches a model id exactly and without regard to case", () => {
    assert.equal(profileOf("openai", "gpt-5-mini"), "openai-gpt-5");
    assert.equal(profileOf("openai", "GPT-5.2"), "openai-gpt-5.2");
    assert.equal(profileOf("mistral", "mistral-small-latest"), "mistral-adjustable");
    assert.equal(profileOf("groq", "openai/gpt-oss-20b"), "groq-gpt-oss");
  });

  it("matches a dated snapshot through its undated id", () => {
    assert.equal(profileOf("openai", "gpt-5-2025-08-07"), "openai-gpt-5");
    assert.equal(profileOf("openai", "gpt-4-0613"), "openai-chat");
    assert.equal(profileOf("anthropic", "claude-opus-4-5-20251101"), "claude-opus-4.5");
    assert.equal(profileOf("anthropic", "claude-haiku-4-5-20251001"), "claude-4.5");
  });

  it("gives an unmatched id the provider fallback, which offers no reasoning", () => {
    const profile = resolveModelProfile("openai", "gpt-9-future");
    assert.equal(profile.known, false);
    assert.equal(profile.reasoning.control, "none");
    assert.equal(profile.temperature, "unsupported");
    assert.equal(profile.outputCapField, "max_completion_tokens");
    assert.equal(resolveModelProfile("custom", "llama3").known, false);
  });

  it("does not let a dated Cohere id fall into another family", () => {
    assert.equal(profileOf("cohere", "command-a-reasoning-08-2025"), "cohere-reasoning");
    assert.equal(profileOf("cohere", "command-r7b-12-2024"), "cohere-chat");
    assert.equal(resolveModelProfile("cohere", "command-r7b-01-2027").known, false);
  });
});

describe("resolveParams", () => {
  const reasoner: ModelProfile = {
    id: "test",
    known: true,
    reasoning: { control: "effort", levels: { off: "none", low: "low", high: "high" }, onByDefault: true },
    temperature: "onlyWhenReasoningOff",
    outputCapField: "max_completion_tokens",
  };
  const defaults: GenerationParams = { temperature: 0.2, maxOutputTokens: 8192 };

  it("drops a temperature the model rejects while it reasons by default", () => {
    assert.deepEqual(resolveParams({}, defaults, reasoner), { outputCapField: "max_completion_tokens", maxOutputTokens: 8192 });
  });

  it("sends the temperature once reasoning is turned off", () => {
    assert.deepEqual(resolveParams({ reasoning: "off" }, defaults, reasoner), {
      outputCapField: "max_completion_tokens",
      maxOutputTokens: 8192,
      temperature: 0.2,
      reasoning: { control: "effort", level: "off", native: "none" },
    });
  });

  it("drops a reasoning level the model does not offer", () => {
    assert.equal(resolveParams({ reasoning: "medium" }, defaults, reasoner).reasoning, undefined);
    assert.equal(resolveParams({ reasoning: "max" }, defaults, reasoner).reasoning, undefined);
  });

  it("lets a requested value override the provider default", () => {
    const resolved = resolveParams({ maxOutputTokens: 1000, reasoning: "high" }, defaults, reasoner);
    assert.equal(resolved.maxOutputTokens, 1000);
    assert.deepEqual(resolved.reasoning, { control: "effort", level: "high", native: "high" });
  });

  it("never sends reasoning to a model without reasoning control", () => {
    const plain: ModelProfile = { ...reasoner, reasoning: { control: "none", levels: {}, onByDefault: false }, temperature: "supported" };
    assert.deepEqual(resolveParams({ reasoning: "high" }, defaults, plain), { outputCapField: "max_completion_tokens", maxOutputTokens: 8192, temperature: 0.2 });
  });
});

describe("resolveRequestParams with the provider defaults", () => {
  it("stops sending temperature to OpenAI models that reject it", () => {
    for (const modelId of ["gpt-5", "gpt-5.5", "gpt-6-sol", "o3", "gpt-6-astra", "gpt-9-future"]) {
      assert.equal(resolveRequestParams("openai", modelId).temperature, undefined, modelId);
    }
    for (const modelId of ["gpt-4o-mini", "gpt-5.1", "gpt-5.2", "gpt-5.4-nano"]) {
      assert.equal(resolveRequestParams("openai", modelId).temperature, 0.2, modelId);
    }
  });

  it("uses max_completion_tokens for every OpenAI model", () => {
    for (const modelId of ["gpt-4o-mini", "gpt-5", "o1", "gpt-9-future"]) {
      assert.equal(resolveRequestParams("openai", modelId).outputCapField, "max_completion_tokens", modelId);
    }
  });

  it("keeps the Gemini thinking cap as a budget on 2.5 and a level on 3.x, never both", () => {
    assert.deepEqual(resolveRequestParams("gemini", "gemini-2.5-flash").reasoning, { control: "budget", level: "medium", native: 4096 });
    assert.deepEqual(resolveRequestParams("gemini", "gemini-3.5-flash").reasoning, { control: "level", level: "medium", native: "medium" });
    assert.equal(resolveRequestParams("gemini", "gemini-3.5-flash").temperature, undefined);
    assert.equal(resolveRequestParams("gemini", "gemma-4-31b-it").reasoning, undefined, "gemma rejects budgets and has no medium level");
  });

  it("keeps Anthropic and Cohere bodies free of optional parameters", () => {
    assert.deepEqual(resolveRequestParams("anthropic", "claude-sonnet-4-6"), { outputCapField: "max_tokens", maxOutputTokens: 8192 });
    assert.deepEqual(resolveRequestParams("cohere", "command-a-03-2025"), { outputCapField: "max_tokens" });
  });
});
