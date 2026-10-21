// Model capability profiles, one ordered rule table per provider, built from
// the capability probe measurements. A model id matches a rule when it is one
// of the rule's ids, either exactly or once a trailing date suffix is removed
// (gpt-5-2025-08-07, claude-opus-4-5-20251101, gpt-4-0613). An id no rule
// matches gets the provider's fallback profile, which sends no optional
// parameter that any measured model of that provider rejected.
//
// levels.off holds the native "off" value where the provider turns
// reasoning off through the same field ("none"); elsewhere it is a marker
// ("disabled", 0) the dialect turns into the provider's own off form.

import type { DirectProviderName } from "../providersConfig";
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TEMPERATURE, REASONING_LEVELS, type GenerationParams, type ReasoningLevel } from "./generationParams";
import { resolveParams, type ModelProfile, type OutputCapField, type ReasoningProfile, type ResolvedParams, type TemperatureSupport } from "./modelProfile";

interface ProfileRule {
  ids: readonly string[];
  profile: ModelProfile;
}

const NO_REASONING: ReasoningProfile = { control: "none", levels: {}, onByDefault: false };

function known(id: string, reasoning: ReasoningProfile, temperature: TemperatureSupport, outputCapField: OutputCapField = "max_tokens"): ModelProfile {
  return { id, known: true, reasoning, temperature, outputCapField };
}

function fallback(id: string, temperature: TemperatureSupport, outputCapField: OutputCapField = "max_tokens"): ModelProfile {
  return { id, known: false, reasoning: NO_REASONING, temperature, outputCapField };
}

const effort = (levels: ReasoningProfile["levels"], onByDefault: boolean): ReasoningProfile => ({ control: "effort", levels, onByDefault });
const level = (levels: ReasoningProfile["levels"], onByDefault: boolean): ReasoningProfile => ({ control: "level", levels, onByDefault });
const budget = (levels: ReasoningProfile["levels"], onByDefault: boolean): ReasoningProfile => ({ control: "budget", levels, onByDefault });

const LOW_TO_HIGH = { low: "low", medium: "medium", high: "high" } as const;

// Every measured OpenAI model accepts max_completion_tokens; the gpt-5,
// gpt-6 and o-series models reject max_tokens.
const OPENAI_RULES: readonly ProfileRule[] = [
  { ids: ["gpt-5", "gpt-5-mini", "gpt-5-nano"], profile: known("openai-gpt-5", effort(LOW_TO_HIGH, true), "unsupported", "max_completion_tokens") },
  { ids: ["gpt-5.1"], profile: known("openai-gpt-5.1", effort({ off: "none", ...LOW_TO_HIGH }, false), "onlyWhenReasoningOff", "max_completion_tokens") },
  {
    ids: ["gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    profile: known("openai-gpt-5.2", effort({ off: "none", ...LOW_TO_HIGH, max: "xhigh" }, false), "onlyWhenReasoningOff", "max_completion_tokens"),
  },
  {
    // Reason by default: temperature alone is rejected, with effort "none"
    // it is accepted.
    ids: ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-luna", "gpt-6-sol"],
    profile: known("openai-gpt-5.5", effort({ off: "none", ...LOW_TO_HIGH, max: "xhigh" }, true), "onlyWhenReasoningOff", "max_completion_tokens"),
  },
  {
    ids: ["o1", "o3", "o3-mini", "o4-mini", "gpt-6.1-sol", "gpt-6-astra"],
    profile: known("openai-reasoning", effort({ ...LOW_TO_HIGH, max: "xhigh" }, true), "unsupported", "max_completion_tokens"),
  },
  {
    ids: ["gpt-4", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo", "gpt-3.5-turbo-16k"],
    profile: known("openai-chat", NO_REASONING, "supported", "max_completion_tokens"),
  },
];

// Gemini 3 accepts temperature but Google advises against changing it, so
// it is never sent. Gemini 3 cannot turn thinking off; "minimal" is not
// offered because several 3.x models reject it.
const GEMINI_RULES: readonly ProfileRule[] = [
  { ids: ["gemini-2.5-flash"], profile: known("gemini-2.5-flash", budget({ off: 0, low: 1024, medium: 4096 }, true), "supported") },
  // Budget 0 is rejected on every Pro model.
  { ids: ["gemini-2.5-pro"], profile: known("gemini-2.5-pro", budget({ low: 1024, medium: 4096 }, true), "supported") },
  {
    ids: [
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-pro-latest",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview-customtools",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.8-flash",
    ],
    profile: known("gemini-3", level(LOW_TO_HIGH, true), "unsupported"),
  },
  // Gemma rejects thinking budgets and accepts only the minimal and high
  // levels; minimal is its lowest setting.
  { ids: ["gemma-4-26b-a4b-it", "gemma-4-31b-it"], profile: known("gemma-4", level({ low: "minimal", high: "high" }, false), "supported") },
];

// Effort is sent as output_config.effort alone (claude-opus-4-5 rejects
// adaptive thinking but accepts the effort); "off" is sent as thinking
// {type: "disabled"}. Temperature is never combined with thinking.
const ANTHROPIC_RULES: readonly ProfileRule[] = [
  {
    ids: ["claude-haiku-5-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7"],
    profile: known("claude-4.7", effort({ off: "disabled", ...LOW_TO_HIGH, max: "max" }, false), "unsupported"),
  },
  // Rejects thinking {type: "disabled"} and thinks by default.
  { ids: ["claude-fable-5"], profile: known("claude-fable-5", effort({ ...LOW_TO_HIGH, max: "max" }, true), "unsupported") },
  { ids: ["claude-sonnet-4-6", "claude-opus-4-6"], profile: known("claude-4.6", effort({ off: "disabled", ...LOW_TO_HIGH, max: "max" }, false), "onlyWhenReasoningOff") },
  { ids: ["claude-opus-4-5"], profile: known("claude-opus-4.5", effort({ off: "disabled", ...LOW_TO_HIGH }, false), "onlyWhenReasoningOff") },
  // No effort and no adaptive thinking: a level is a thinking budget.
  { ids: ["claude-haiku-4-5", "claude-sonnet-4-5"], profile: known("claude-4.5", budget({ off: 0, low: 1024 }, false), "onlyWhenReasoningOff") },
];

// "off" is sent as thinking {type: "disabled"}; the documented effort
// values are low, high and max.
const DEEPSEEK_RULES: readonly ProfileRule[] = [
  { ids: ["deepseek-flash", "deepseek-v4-pro"], profile: known("deepseek", effort({ off: "disabled", low: "low", high: "high", max: "max" }, true), "supported") },
];

const GROQ_RULES: readonly ProfileRule[] = [
  { ids: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], profile: known("groq-gpt-oss", effort(LOW_TO_HIGH, true), "supported") },
  { ids: ["qwen/qwen3.8-27b"], profile: known("groq-qwen", effort({ off: "none", ...LOW_TO_HIGH }, false), "supported") },
  { ids: ["allam-2-7b"], profile: known("groq-chat", NO_REASONING, "supported") },
];

// Temperature together with reasoning was not measured on the adjustable
// models, so it is sent only while reasoning is off.
const MISTRAL_RULES: readonly ProfileRule[] = [
  {
    ids: [
      "mistral-small-latest",
      "mistral-medium-latest",
      "mistral-medium-3-5",
      "magistral-small-latest",
      "magistral-medium-latest",
      "mistral-vibe-cli-fast",
      "mistral-vibe-cli-latest",
      "mistral-vibe-cli-with-tools",
    ],
    profile: known("mistral-adjustable", effort({ off: "none", high: "high" }, false), "onlyWhenReasoningOff"),
  },
  { ids: ["glm-5-2"], profile: known("mistral-glm-5", effort({ off: "none", ...LOW_TO_HIGH, max: "max" }, false), "onlyWhenReasoningOff") },
  // Reasons by default and accepts temperature while doing so.
  { ids: ["zai-glm-latest"], profile: known("mistral-zai-glm", effort({ low: "low", high: "high", max: "max" }, true), "supported") },
  {
    ids: ["codestral-latest", "ministral-3b-latest", "ministral-8b-latest", "ministral-14b-latest", "mistral-large-latest"],
    profile: known("mistral-chat", NO_REASONING, "supported"),
  },
];

// "off" is sent as thinking {type: "disabled"}, a level as a token budget.
// Only these models accept a budget; every Cohere model accepts "disabled".
const COHERE_RULES: readonly ProfileRule[] = [
  { ids: ["command-a-reasoning-08-2025", "north-mini-code-1-0"], profile: known("cohere-reasoning", budget({ off: 0, low: 1024 }, true), "supported") },
  { ids: ["command-a-plus-05-2026"], profile: known("cohere-plus", budget({ off: 0, low: 1024 }, false), "supported") },
  {
    ids: [
      "command-a-03-2025",
      "command-r-08-2024",
      "command-r-plus-08-2024",
      "command-r7b-12-2024",
      "command-r7b-arabic-02-2025",
      "c4ai-aya-expanse-32b",
      "tiny-aya-earth",
      "tiny-aya-fire",
      "tiny-aya-global",
      "tiny-aya-water",
    ],
    profile: known("cohere-chat", NO_REASONING, "supported"),
  },
];

// Only the documented effort values are offered: every value was accepted,
// so the probe cannot tell which ones the models honor.
const STEPFUN_RULES: readonly ProfileRule[] = [{ ids: ["step-3.5-flash", "step-3.7-flash", "step-5-preview"], profile: known("stepfun", effort(LOW_TO_HIGH, true), "supported") }];

interface ProviderProfiles {
  rules: readonly ProfileRule[];
  fallback: ModelProfile;
  // What a request carries when the user leaves a parameter on Auto: the
  // values each provider has always been sent. The profile still drops any
  // value a model rejects.
  defaults: GenerationParams;
}

const CHAT_DEFAULTS: GenerationParams = { temperature: DEFAULT_TEMPERATURE, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS };

const PROVIDER_PROFILES: Readonly<Record<DirectProviderName, ProviderProfiles>> = {
  openai: { rules: OPENAI_RULES, fallback: fallback("openai-unknown", "unsupported", "max_completion_tokens"), defaults: CHAT_DEFAULTS },
  // "medium" is a 4096-token thinking budget on Gemini 2.5, which caps the
  // reasoning so it leaves room for the message.
  gemini: { rules: GEMINI_RULES, fallback: fallback("gemini-unknown", "unsupported"), defaults: { ...CHAT_DEFAULTS, reasoning: "medium" } },
  anthropic: { rules: ANTHROPIC_RULES, fallback: fallback("anthropic-unknown", "unsupported"), defaults: { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS } },
  deepseek: { rules: DEEPSEEK_RULES, fallback: fallback("deepseek-unknown", "supported"), defaults: CHAT_DEFAULTS },
  groq: { rules: GROQ_RULES, fallback: fallback("groq-unknown", "supported"), defaults: CHAT_DEFAULTS },
  mistral: { rules: MISTRAL_RULES, fallback: fallback("mistral-unknown", "supported"), defaults: CHAT_DEFAULTS },
  // Cohere picks its own temperature and output cap.
  cohere: { rules: COHERE_RULES, fallback: fallback("cohere-unknown", "supported"), defaults: {} },
  stepfun: { rules: STEPFUN_RULES, fallback: fallback("stepfun-unknown", "supported"), defaults: CHAT_DEFAULTS },
  // A user-supplied OpenAI-compatible server: only the classic fields every
  // such server understands.
  custom: { rules: [], fallback: fallback("custom", "supported"), defaults: CHAT_DEFAULTS },
  // A local Ollama server: temperature and the output cap (num_predict) are
  // the only parameters every Ollama model accepts; reasoning is not
  // offered.
  ollama: { rules: [], fallback: fallback("ollama", "supported"), defaults: CHAT_DEFAULTS },
};

// -2025-08-07, -20251101, -0613: a dated snapshot of a known model.
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

export function resolveModelProfile(providerName: DirectProviderName, modelId: string): ModelProfile {
  const { rules, fallback: unknownProfile } = PROVIDER_PROFILES[providerName];
  const id = modelId.trim().toLowerCase();
  const undated = id.replace(DATE_SUFFIX, "");
  const rule = rules.find((candidate) => candidate.ids.includes(id) || candidate.ids.includes(undated));
  return rule ? rule.profile : unknownProfile;
}

// What the settings UI may offer for one model: the reasoning levels it
// accepts (in REASONING_LEVELS order), whether it takes a temperature, and
// whether its profile is measured (known) or the provider fallback.
export interface ModelSupport {
  known: boolean;
  reasoningLevels: ReasoningLevel[];
  temperature: TemperatureSupport;
}

export function modelSupport(providerName: DirectProviderName, modelId: string): ModelSupport {
  const profile = resolveModelProfile(providerName, modelId);
  const reasoningLevels = profile.reasoning.control === "none" ? [] : REASONING_LEVELS.filter((level) => profile.reasoning.levels[level] !== undefined);
  return { known: profile.known, reasoningLevels, temperature: profile.temperature };
}

export function providerDefaultParams(providerName: DirectProviderName): GenerationParams {
  return PROVIDER_PROFILES[providerName].defaults;
}

// The values one request to this model carries: the requested parameters
// over the provider defaults, minus everything the model's profile rejects.
export function resolveRequestParams(providerName: DirectProviderName, modelId: string, params: GenerationParams = {}): ResolvedParams {
  return resolveParams(params, providerDefaultParams(providerName), resolveModelProfile(providerName, modelId));
}
