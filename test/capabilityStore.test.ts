// Tests for the data-driven capability store: baseline parity with the
// previous hard-coded tables, source-file overrides used during extension
// development, the conservative fallback for unmeasured models, and the
// pure merge the Developer tab writes into capabilities.json with.

import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
  initializeCapabilityStore,
  mergeRuleIntoCapabilitiesFile,
  parseCapabilitiesFile,
  providerDefaults,
  resolveModelProfile,
  type CapabilityRule,
} from "../src/ai/params/capabilityStore";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-cap-"));
});

afterEach(() => {
  initializeCapabilityStore(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

const rule = (ids: string[], id: string): CapabilityRule => ({
  ids,
  profile: { id, reasoning: { control: "none", levels: {}, onByDefault: false }, temperature: "supported", outputCapField: "max_tokens" },
});

describe("capabilityStore baseline", () => {
  it("resolves the shipped measured profiles exactly like the previous tables", () => {
    assert.equal(resolveModelProfile("openai", "gpt-5").id, "openai-gpt-5");
    assert.equal(resolveModelProfile("openai", "gpt-5").known, true);
    assert.equal(resolveModelProfile("openai", "gpt-5.2").reasoning.levels.max, "xhigh");
    assert.equal(resolveModelProfile("gemini", "gemini-3.5-flash").id, "gemini-3");
    assert.equal(resolveModelProfile("anthropic", "claude-opus-4-5").id, "claude-opus-4.5");
    assert.equal(resolveModelProfile("mistral", "mistral-small-latest").id, "mistral-adjustable");
    assert.equal(resolveModelProfile("cohere", "command-a-reasoning-08-2025").id, "cohere-reasoning");
    assert.equal(resolveModelProfile("deepseek", "deepseek-flash").id, "deepseek");
    assert.equal(resolveModelProfile("groq", "openai/gpt-oss-20b").id, "groq-gpt-oss");
    assert.equal(resolveModelProfile("stepfun", "step-3.5-flash").id, "stepfun");
  });

  it("matches a dated snapshot through its undated id", () => {
    assert.equal(resolveModelProfile("openai", "gpt-5-2025-08-07").id, "openai-gpt-5");
    assert.equal(resolveModelProfile("anthropic", "claude-opus-4-5-20251101").id, "claude-opus-4.5");
  });

  it("gives an unmatched id the provider fallback, flagged unknown", () => {
    const profile = resolveModelProfile("openai", "gpt-9-future");
    assert.equal(profile.known, false);
    assert.equal(profile.reasoning.control, "none");
    assert.equal(profile.temperature, "unsupported");
    assert.equal(profile.outputCapField, "max_completion_tokens");
    assert.deepEqual(resolveModelProfile("ollama", "llama3.2"), {
      id: "ollama",
      known: false,
      reasoning: { control: "none", levels: {}, onByDefault: false },
      temperature: "supported",
      outputCapField: "max_tokens",
    });
  });

  it("keeps the provider defaults", () => {
    assert.deepEqual(providerDefaults("openai"), { temperature: 0.2, maxOutputTokens: 8192 });
    assert.deepEqual(providerDefaults("gemini"), { temperature: 0.2, maxOutputTokens: 8192, reasoning: "medium" });
    assert.deepEqual(providerDefaults("cohere"), {});
  });
});

describe("capabilityStore source file", () => {
  it("reads capabilities from the source file when one is configured", () => {
    const file = path.join(dir, "capabilities.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { openai: { rules: [rule(["gpt-5"], "source-override")] } } }), "utf8");
    initializeCapabilityStore(file);
    assert.equal(resolveModelProfile("openai", "gpt-5").id, "source-override");
    // The source file replaces the baseline as a whole: a provider it does
    // not mention gets the generic fallback, not the baseline table.
    const geminiProfile = resolveModelProfile("gemini", "gemini-3.5-flash");
    assert.equal(geminiProfile.id, "unknown");
    assert.equal(geminiProfile.known, false);
  });

  it("falls back to the bundled baseline when the source file is corrupt or missing", () => {
    initializeCapabilityStore(path.join(dir, "missing.json"));
    assert.equal(resolveModelProfile("openai", "gpt-5").id, "openai-gpt-5");
    const file = path.join(dir, "capabilities.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    initializeCapabilityStore(file);
    assert.equal(resolveModelProfile("openai", "gpt-5").id, "openai-gpt-5");
  });
});

describe("mergeRuleIntoCapabilitiesFile", () => {
  it("adds a rule for a brand-new model and keeps every other provider", () => {
    const base = JSON.stringify({ version: 1, providers: { openai: { rules: [rule(["gpt-4"], "openai-chat")] }, gemini: { rules: [rule(["gemini-3.5-flash"], "gemini-3")] } } });
    const merged = mergeRuleIntoCapabilitiesFile(base, "openai", rule(["gpt-99"], "user-gpt-99"));
    const parsed = parseCapabilitiesFile(merged) as { providers: { openai?: { rules?: CapabilityRule[] }; gemini?: { rules?: CapabilityRule[] } } };
    assert.equal(parsed.providers.openai?.rules?.length, 2);
    assert.equal(parsed.providers.gemini?.rules?.length, 1);
  });

  it("replaces rules whose ids overlap and puts the new rule first", () => {
    const base = JSON.stringify({ version: 1, providers: { openai: { rules: [rule(["gpt-5", "gpt-5-mini"], "shipped")] } } });
    const merged = mergeRuleIntoCapabilitiesFile(base, "openai", rule(["gpt-5"], "measured"));
    const parsed = parseCapabilitiesFile(merged) as { providers: { openai?: { rules?: CapabilityRule[] } } };
    assert.deepEqual(
      parsed.providers.openai?.rules?.map((entry) => entry.profile.id),
      ["measured"],
    );
  });

  it("accepts boolean and string native values in reasoning levels", () => {
    const thinkRule: CapabilityRule = {
      ids: ["qwen3"],
      profile: {
        id: "ollama-measured",
        reasoning: { control: "think", levels: { off: false, low: true, high: "high" }, onByDefault: true },
        temperature: "supported",
        outputCapField: "max_tokens",
      },
    };
    const merged = mergeRuleIntoCapabilitiesFile("{", "ollama", thinkRule);
    const parsed = parseCapabilitiesFile(merged);
    assert.equal(parsed?.providers.ollama?.rules?.[0]?.profile.reasoning.levels.off, false);
    assert.equal(parsed?.providers.ollama?.rules?.[0]?.profile.reasoning.levels.low, true);
  });

  it("tolerates a corrupt existing file", () => {
    const merged = mergeRuleIntoCapabilitiesFile("{ not json", "openai", rule(["gpt-99"], "user-gpt-99"));
    const parsed = parseCapabilitiesFile(merged) as { providers: { openai?: { rules?: CapabilityRule[] } } };
    assert.equal(parsed.providers.openai?.rules?.length, 1);
  });
});
