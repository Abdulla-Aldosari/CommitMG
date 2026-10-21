// Tests for the mechanical transcription of probe outcomes into stored
// capability profiles (the Developer tab's merge step). The exact case ids
// come from probeCases.ts; every expectation here mirrors the same mapping.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { profileFromOutcomes } from "../src/dev/probe/profileFromOutcomes";
import type { ProbeTarget } from "../src/dev/probe/probeCases";
import type { ProbeOutcome } from "../src/dev/probe/probeResult";

const ok = (caseId: string, shape?: Record<string, string>): ProbeOutcome => ({ caseId, status: "accepted", httpStatus: 200, latencyMs: 1, shape });
const rejected = (caseId: string): ProbeOutcome => ({ caseId, status: "rejected", httpStatus: 400, latencyMs: 1 });

const target = (providerName: ProbeTarget["providerName"], wireFormat: ProbeTarget["wireFormat"]): ProbeTarget => ({
  providerName,
  wireFormat,
  baseUrl: "https://api.example.com/v1",
  apiKey: "test-key",
});

describe("profileFromOutcomes", () => {
  it("returns null when no output-cap field was accepted", () => {
    assert.equal(profileFromOutcomes(target("openai", "openai-chat"), null, [ok("baseline")]), null);
  });

  it("transcribes an OpenAI-style reasoning model", () => {
    const outcomes = [
      ok("shape-default", { "choices[0].message.reasoning_content": "string" }),
      rejected("temperature-0.2"),
      ok("reasoning-none-temperature"),
      ok("reasoning-effort-none"),
      ok("reasoning-effort-low"),
      ok("reasoning-effort-medium"),
      ok("reasoning-effort-high"),
      rejected("reasoning-effort-xhigh"),
    ];
    const profile = profileFromOutcomes(target("openai", "openai-chat"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.equal(profile.id, "openai-measured");
    assert.deepEqual(profile.reasoning, {
      control: "effort",
      levels: { off: "none", low: "low", medium: "medium", high: "high" },
      onByDefault: true,
    });
    assert.equal(profile.temperature, "onlyWhenReasoningOff");
    assert.equal(profile.outputCapField, "max_tokens");
  });

  it("uses minimal as the low level only when low itself is rejected", () => {
    const outcomes = [ok("reasoning-effort-minimal"), rejected("reasoning-effort-low")];
    const profile = profileFromOutcomes(target("openai", "openai-chat"), "max_completion_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.equal(profile.reasoning.levels.low, "minimal");
  });

  it("keeps reasoning off for a plain chat model", () => {
    const outcomes = [ok("temperature-0.2"), ok("shape-default"), rejected("reasoning-effort-none"), rejected("reasoning-effort-low")];
    const profile = profileFromOutcomes(target("openai", "openai-chat"), "max_completion_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.equal(profile.reasoning.control, "none");
    assert.equal(profile.temperature, "supported");
  });

  it("transcribes DeepSeek's thinking-disabled off value", () => {
    const outcomes = [
      ok("reasoning-effort-low"),
      ok("reasoning-effort-high"),
      ok("reasoning-effort-max"),
      ok("thinking-disabled"),
      rejected("temperature-0.2"),
      ok("thinking-disabled-temperature"),
    ];
    const profile = profileFromOutcomes(target("deepseek", "openai-chat"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, { control: "effort", levels: { off: "disabled", low: "low", high: "high", max: "max" }, onByDefault: false });
    assert.equal(profile.temperature, "onlyWhenReasoningOff");
  });

  it("transcribes an Anthropic effort model", () => {
    const outcomes = [
      ok("effort-low"),
      ok("effort-medium"),
      ok("effort-high"),
      ok("effort-max"),
      rejected("effort-xhigh"),
      ok("thinking-disabled"),
      rejected("temperature-0.2"),
      rejected("thinking-adaptive-temperature"),
      ok("shape-default", { "content[*].type": "text|thinking" }),
    ];
    const profile = profileFromOutcomes(target("anthropic", "anthropic"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, {
      control: "effort",
      levels: { off: "disabled", low: "low", medium: "medium", high: "high", max: "max" },
      onByDefault: true,
    });
    assert.equal(profile.temperature, "unsupported");
  });

  it("transcribes an Anthropic budget model when no effort is accepted", () => {
    const outcomes = [rejected("effort-low"), rejected("effort-medium"), ok("thinking-enabled-budget"), ok("thinking-disabled")];
    const profile = profileFromOutcomes(target("anthropic", "anthropic"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, { control: "budget", levels: { off: 0, low: 1024 }, onByDefault: false });
  });

  it("prefers the level form over budgets for Gemini", () => {
    const outcomes = [
      ok("thinking-level-low"),
      ok("thinking-level-high"),
      ok("thinking-budget-0"),
      ok("temperature-0.2"),
      ok("shape-default", { "candidates[0].content.parts[0].thought": "boolean" }),
    ];
    const profile = profileFromOutcomes(target("gemini", "gemini"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, { control: "level", levels: { low: "low", high: "high" }, onByDefault: true });
    assert.equal(profile.temperature, "supported");
  });

  it("transcribes a Gemini budget model when no level is accepted", () => {
    const outcomes = [rejected("thinking-level-low"), ok("thinking-budget-0"), ok("thinking-budget-1024")];
    const profile = profileFromOutcomes(target("gemini", "gemini"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, { control: "budget", levels: { off: 0, low: 1024 }, onByDefault: false });
  });

  it("transcribes a Cohere thinking model", () => {
    const outcomes = [ok("thinking-disabled"), ok("thinking-budget"), ok("temperature-0.2"), ok("shape-default", { reasoning: "string" })];
    const profile = profileFromOutcomes(target("cohere", "cohere"), "max_tokens", outcomes) as NonNullable<ReturnType<typeof profileFromOutcomes>>;
    assert.deepEqual(profile.reasoning, { control: "budget", levels: { off: 0, low: 1024 }, onByDefault: true });
    assert.equal(profile.temperature, "supported");
  });
});
