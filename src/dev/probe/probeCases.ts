// Builds the request matrix for the developer capability probe: for one
// provider and one model, the exact HTTP requests that test which output-cap
// field, temperature, and reasoning controls the model accepts. Pure and
// vscode-free so the matrix is unit-tested; the runner (runProbe.ts) only
// sends what this module builds.

import type { DirectProviderName } from "../../ai/providersConfig";

export type WireFormat = "openai-chat" | "mistral" | "anthropic" | "gemini" | "cohere";

// The output-cap field of an OpenAI-style request. Other wire formats have a
// single fixed field and ignore this value.
export type CapField = "max_tokens" | "max_completion_tokens";

export type JsonObject = { [key: string]: unknown };

export interface ProbeTarget {
  providerName: DirectProviderName;
  wireFormat: WireFormat;
  // Only used by the OpenAI-style wire format; the other formats have fixed
  // endpoints.
  baseUrl: string;
  apiKey: string;
}

export interface ProbeCase {
  id: string;
  description: string;
  // Deep-merged into the base body; an undefined value removes the key.
  patch: JsonObject;
  // Output-token cap for this case. Small by default to keep the probe cheap;
  // larger only where the API demands room (thinking budgets) or where the
  // case exists to capture the shape of a real reply.
  outputTokens: number;
}

export interface ProbeRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

export const PROBE_SYSTEM_PROMPT = "Reply with the single word OK.";
export const PROBE_USER_PROMPT = "Say OK.";
export const PROBE_OUTPUT_TOKENS = 16;
export const SHAPE_OUTPUT_TOKENS = 512;
export const THINKING_BUDGET_TOKENS = 1024;
const THINKING_CASE_OUTPUT_TOKENS = 1100;

const EFFORT_VALUES: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const GEMINI_LEVELS: readonly string[] = ["minimal", "low", "medium", "high"];
const ANTHROPIC_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

export function wireFormatFor(providerName: DirectProviderName): WireFormat {
  switch (providerName) {
    case "gemini":
      return "gemini";
    case "anthropic":
      return "anthropic";
    case "mistral":
      return "mistral";
    case "cohere":
      return "cohere";
    case "openai":
    case "deepseek":
    case "groq":
    case "stepfun":
    case "custom":
      return "openai-chat";
    default: {
      const exhaustiveCheck: never = providerName;
      throw new Error(`Unknown provider: ${String(exhaustiveCheck)}`);
    }
  }
}

const probeCase = (id: string, description: string, patch: JsonObject, outputTokens: number = PROBE_OUTPUT_TOKENS): ProbeCase => ({ id, description, patch, outputTokens });

// The cases run first for every model: they find the output-cap field the
// model accepts. Every later case reuses that field, so a feature case never
// fails just because of the cap field. Only the OpenAI-style format has two
// candidate fields.
export function capProbeCases(wireFormat: WireFormat): Array<{ probeCase: ProbeCase; capField: CapField }> {
  const baseline = probeCase("baseline", "Minimal request with the classic output cap field", {});
  if (wireFormat !== "openai-chat") {
    return [{ probeCase: baseline, capField: "max_tokens" }];
  }
  return [
    { probeCase: baseline, capField: "max_tokens" },
    { probeCase: probeCase("cap-max-completion-tokens", "Minimal request with max_completion_tokens instead of max_tokens", {}), capField: "max_completion_tokens" },
  ];
}

// The feature cases for one provider, run after the cap field is known.
export function featureProbeCases(target: Pick<ProbeTarget, "providerName" | "wireFormat">): ProbeCase[] {
  const shape = probeCase("shape-default", "Default parameters with room for a full reply, to record the response shape", {}, SHAPE_OUTPUT_TOKENS);
  const temperature = probeCase("temperature-0.2", "temperature 0.2", { temperature: 0.2 });

  switch (target.wireFormat) {
    case "openai-chat":
    case "mistral": {
      const cases = [
        shape,
        temperature,
        ...EFFORT_VALUES.map((value) => probeCase(`reasoning-effort-${value}`, `reasoning_effort "${value}"`, { reasoning_effort: value })),
        probeCase("reasoning-none-temperature", 'reasoning_effort "none" together with temperature 0.2', { reasoning_effort: "none", temperature: 0.2 }),
        probeCase(
          "shape-reasoning-high",
          'reasoning_effort "high" with room for a full reply, to record the reasoning response shape',
          { reasoning_effort: "high" },
          SHAPE_OUTPUT_TOKENS,
        ),
      ];
      if (target.providerName === "deepseek") {
        cases.push(
          probeCase("thinking-enabled", 'thinking {type: "enabled"}', { thinking: { type: "enabled" } }),
          probeCase("thinking-disabled", 'thinking {type: "disabled"}', { thinking: { type: "disabled" } }),
          probeCase("thinking-disabled-temperature", 'thinking {type: "disabled"} together with temperature 0.2', { thinking: { type: "disabled" }, temperature: 0.2 }),
        );
      }
      if (target.providerName === "groq") {
        cases.push(
          probeCase("reasoning-format-hidden", 'reasoning_format "hidden"', { reasoning_format: "hidden" }),
          probeCase("include-reasoning-false", "include_reasoning false", { include_reasoning: false }),
        );
      }
      return cases;
    }
    case "anthropic":
      return [
        shape,
        temperature,
        ...ANTHROPIC_EFFORTS.map((value) => probeCase(`effort-${value}`, `output_config.effort "${value}"`, { output_config: { effort: value } })),
        probeCase("thinking-adaptive", 'thinking {type: "adaptive"}', { thinking: { type: "adaptive" } }),
        probeCase("thinking-adaptive-temperature", 'thinking {type: "adaptive"} together with temperature 0.2', { thinking: { type: "adaptive" }, temperature: 0.2 }),
        probeCase(
          "thinking-enabled-budget",
          `thinking {type: "enabled", budget_tokens: ${THINKING_BUDGET_TOKENS}}`,
          { thinking: { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS } },
          THINKING_CASE_OUTPUT_TOKENS,
        ),
        probeCase("thinking-disabled", 'thinking {type: "disabled"}', { thinking: { type: "disabled" } }),
      ];
    case "gemini":
      return [
        shape,
        probeCase("temperature-0.2", "generationConfig.temperature 0.2", { generationConfig: { temperature: 0.2 } }),
        probeCase("thinking-budget-0", "thinkingBudget 0 (thinking off)", { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }),
        probeCase(
          "thinking-budget-1024",
          `thinkingBudget ${THINKING_BUDGET_TOKENS}`,
          { generationConfig: { thinkingConfig: { thinkingBudget: THINKING_BUDGET_TOKENS } } },
          THINKING_CASE_OUTPUT_TOKENS,
        ),
        probeCase("thinking-budget-dynamic", "thinkingBudget -1 (dynamic)", { generationConfig: { thinkingConfig: { thinkingBudget: -1 } } }),
        ...GEMINI_LEVELS.map((value) => probeCase(`thinking-level-${value}`, `thinkingLevel "${value}"`, { generationConfig: { thinkingConfig: { thinkingLevel: value } } })),
        probeCase("thinking-level-and-budget", "thinkingLevel and thinkingBudget together", {
          generationConfig: { thinkingConfig: { thinkingLevel: "low", thinkingBudget: THINKING_BUDGET_TOKENS } },
        }),
      ];
    case "cohere":
      return [
        shape,
        temperature,
        probeCase("thinking-disabled", 'thinking {type: "disabled"}', { thinking: { type: "disabled" } }),
        probeCase(
          "thinking-budget",
          `thinking {type: "enabled", token_budget: ${THINKING_BUDGET_TOKENS}}`,
          { thinking: { type: "enabled", token_budget: THINKING_BUDGET_TOKENS } },
          THINKING_CASE_OUTPUT_TOKENS,
        ),
      ];
    default: {
      const exhaustiveCheck: never = target.wireFormat;
      throw new Error(`Unknown wire format: ${String(exhaustiveCheck)}`);
    }
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep-merges patch into a copy of base. Nested plain objects merge; every
// other value replaces; an undefined value removes the key.
export function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete result[key];
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as JsonObject, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function baseBody(wireFormat: WireFormat, modelId: string, capField: CapField, outputTokens: number): JsonObject {
  const chatMessages = [
    { role: "system", content: PROBE_SYSTEM_PROMPT },
    { role: "user", content: PROBE_USER_PROMPT },
  ];
  switch (wireFormat) {
    case "openai-chat":
      return { model: modelId, messages: chatMessages, [capField]: outputTokens };
    case "mistral":
    case "cohere":
      return { model: modelId, messages: chatMessages, max_tokens: outputTokens };
    case "anthropic":
      return { model: modelId, max_tokens: outputTokens, system: PROBE_SYSTEM_PROMPT, messages: [{ role: "user", content: PROBE_USER_PROMPT }] };
    case "gemini":
      return {
        system_instruction: { parts: [{ text: PROBE_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: PROBE_USER_PROMPT }] }],
        generationConfig: { maxOutputTokens: outputTokens },
      };
    default: {
      const exhaustiveCheck: never = wireFormat;
      throw new Error(`Unknown wire format: ${String(exhaustiveCheck)}`);
    }
  }
}

function endpointFor(target: ProbeTarget, modelId: string): { url: string; headers: Record<string, string> } {
  const json = { "Content-Type": "application/json" };
  switch (target.wireFormat) {
    case "openai-chat":
      return { url: `${target.baseUrl}/chat/completions`, headers: target.apiKey ? { ...json, Authorization: `Bearer ${target.apiKey}` } : json };
    case "mistral":
      return { url: "https://api.mistral.ai/v1/chat/completions", headers: { ...json, Authorization: `Bearer ${target.apiKey}` } };
    case "cohere":
      return { url: "https://api.cohere.com/v2/chat", headers: { ...json, Authorization: `Bearer ${target.apiKey}` } };
    case "anthropic":
      return { url: "https://api.anthropic.com/v1/messages", headers: { ...json, "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" } };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
        headers: { ...json, "x-goog-api-key": target.apiKey },
      };
    default: {
      const exhaustiveCheck: never = target.wireFormat;
      throw new Error(`Unknown wire format: ${String(exhaustiveCheck)}`);
    }
  }
}

// Builds the exact HTTP request for one model and one case. The API key only
// ever travels in a header.
export function buildProbeRequest(target: ProbeTarget, modelId: string, testCase: ProbeCase, capField: CapField): ProbeRequest {
  const { url, headers } = endpointFor(target, modelId);
  const body = deepMerge(baseBody(target.wireFormat, modelId, capField, testCase.outputTokens), testCase.patch);
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

// Number of requests one model costs: the cap cases plus the feature cases.
export function requestsPerModel(target: Pick<ProbeTarget, "providerName" | "wireFormat">): number {
  return capProbeCases(target.wireFormat).length + featureProbeCases(target).length;
}
