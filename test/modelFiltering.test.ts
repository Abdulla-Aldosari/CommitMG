// Unit tests for the centralized live-model filtering pipeline
// (filterProviderModels in src/ai/providersConfig.ts). The tests lock in the
// full behavior: keyword exclusion, deduplication, exact-ID exclusion, and
// dated/versioned model removal.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import type { ModelListEntry } from "../src/ai/aiClient";
import { filterProviderModels } from "../src/ai/providersConfig";

function entry(modelId: string): ModelListEntry {
  return { modelId, modelLabel: modelId };
}

describe("filterProviderModels", () => {
  it("removes models whose ID contains an excluded keyword (Step 0)", () => {
    const raw = [entry("gpt-4o"), entry("whisper-1"), entry("tts-1"), entry("dall-e-3"), entry("text-embedding-3-small")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o"],
    );
  });

  it("drops exact duplicate IDs, keeping the first occurrence (Step 1)", () => {
    const raw = [entry("gpt-4o"), entry("gpt-4o"), entry("gpt-4.1")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o", "gpt-4.1"],
    );
  });

  it("removes IDs listed in modelIdExcludeExact (Step 2)", () => {
    const raw = [entry("mistral-medium-3-5"), entry("mistral-medium-3.5"), entry("mistral-medium-latest"), entry("mistral-medium")];
    const result = filterProviderModels("mistral", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["mistral-medium-3-5", "mistral-medium-latest"],
    );
  });

  it("removes a dated model when its clean alias exists (Step 3)", () => {
    const raw = [entry("gpt-4o"), entry("gpt-4o-2024-11-20")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o"],
    );
  });

  it("keeps a dated model when no clean alias exists (Step 3)", () => {
    const raw = [entry("gpt-4o-2024-11-20")];
    const result = filterProviderModels("openai", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gpt-4o-2024-11-20"],
    );
  });

  it("removes a dated model when a -latest alias exists (Step 3)", () => {
    // "codestral-latest" covers "codestral-2508".
    const raw = [entry("codestral-latest"), entry("codestral-2508")];
    const result = filterProviderModels("mistral", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["codestral-latest"],
    );
  });

  it("hides OpenAI models that chat completions cannot serve", () => {
    const raw = [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-6-sol",
      "o3",
      "o1-pro",
      "gpt-5-pro",
      "gpt-5.2-pro",
      "gpt-5.5-pro",
      "gpt-5-pro-2025-10-06",
      "gpt-5-chat-latest",
      "gpt-5.3-chat-latest",
      "chat-latest",
      "gpt-live-1",
    ].map(entry);
    assert.deepEqual(
      filterProviderModels("openai", raw).map((m) => m.modelId),
      ["gpt-5.4", "gpt-5.4-mini", "gpt-6-sol", "o3"],
    );
  });

  it("hides Gemini models that generateContent with a system prompt cannot serve, but keeps Pro models", () => {
    const raw = ["gemini-3.8-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-omni-flash-preview", "gemini-omni-1.1-flash", "gemini-3.5-transcribe"].map(entry);
    assert.deepEqual(
      filterProviderModels("gemini", raw).map((m) => m.modelId),
      ["gemini-3.8-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
    );
  });

  it("hides Mistral Labs models by prefix only", () => {
    const raw = ["mistral-small-latest", "labs-leanstral-1-5", "devlabs-model"].map(entry);
    assert.deepEqual(
      filterProviderModels("mistral", raw).map((m) => m.modelId),
      ["mistral-small-latest", "devlabs-model"],
    );
  });

  it("removes short versioned suffixes when a bare name exists (Step 3)", () => {
    // "gemini-2.0-flash" covers "gemini-2.0-flash-001".
    const raw = [entry("gemini-2.0-flash"), entry("gemini-2.0-flash-001")];
    const result = filterProviderModels("gemini", raw);
    assert.deepEqual(
      result.map((m) => m.modelId),
      ["gemini-2.0-flash"],
    );
  });
});
