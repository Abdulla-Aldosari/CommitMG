// What one model accepts, in neutral terms, and the pure step that turns
// neutral generation parameters into the values a request may carry. The
// dialects (src/ai/dialects/) only translate a ResolvedParams into a
// provider body; every "may this model take this value" decision lives here.

import type { GenerationParams, ReasoningLevel } from "./generationParams";

// How a model's reasoning is controlled. Each dialect maps the control to
// its own field: "effort" is reasoning_effort (OpenAI style) or adaptive
// thinking plus an effort value (Anthropic); "level" is Gemini's
// thinkingLevel; "budget" is a thinking token budget (Gemini 2.5,
// Anthropic, Cohere).
export type ReasoningControl = "none" | "effort" | "level" | "budget";

// "onlyWhenReasoningOff": the model rejects temperature while it reasons
// (and accepts it once reasoning is off).
export type TemperatureSupport = "supported" | "unsupported" | "onlyWhenReasoningOff";

// The output-cap field of an OpenAI-style body. The other wire formats have
// one fixed field and ignore this value.
export type OutputCapField = "max_tokens" | "max_completion_tokens";

export interface ReasoningProfile {
  control: ReasoningControl;
  // Native value per neutral level. A level absent here is not offered for
  // this model; "off" present means reasoning can be turned off.
  levels: Readonly<Partial<Record<ReasoningLevel, string | number>>>;
  // True when the model reasons unless the request turns it off. Decides
  // whether an "onlyWhenReasoningOff" temperature may be sent when the
  // request leaves reasoning on Auto.
  onByDefault: boolean;
}

export interface ModelProfile {
  // Stable name of the profile, for tests and diagnostics.
  id: string;
  // False for the provider fallback a model id gets when no rule matches it:
  // only parameters every measured model of that provider accepts.
  known: boolean;
  reasoning: ReasoningProfile;
  temperature: TemperatureSupport;
  outputCapField: OutputCapField;
}

export interface ResolvedReasoning {
  control: Exclude<ReasoningControl, "none">;
  level: ReasoningLevel;
  native: string | number;
}

// The values one request carries. An absent field is not sent at all.
export interface ResolvedParams {
  temperature?: number;
  maxOutputTokens?: number;
  outputCapField: OutputCapField;
  reasoning?: ResolvedReasoning;
}

// Merges the requested parameters over the provider defaults and keeps only
// what the profile accepts. A reasoning level the model does not offer and a
// temperature the model rejects in the resolved reasoning state are dropped,
// never sent.
export function resolveParams(params: GenerationParams, defaults: GenerationParams, profile: ModelProfile): ResolvedParams {
  const level = params.reasoning ?? defaults.reasoning;
  const { control, levels, onByDefault } = profile.reasoning;
  const native = level !== undefined && control !== "none" ? levels[level] : undefined;
  const reasoning = level !== undefined && control !== "none" && native !== undefined ? { control, level, native } : undefined;

  const reasoningOff = reasoning ? reasoning.level === "off" : !onByDefault;
  const temperatureAllowed = profile.temperature === "supported" || (profile.temperature === "onlyWhenReasoningOff" && reasoningOff);
  const temperature = params.temperature ?? defaults.temperature;
  const maxOutputTokens = params.maxOutputTokens ?? defaults.maxOutputTokens;

  const resolved: ResolvedParams = { outputCapField: profile.outputCapField };
  if (temperature !== undefined && temperatureAllowed) {
    resolved.temperature = temperature;
  }
  if (maxOutputTokens !== undefined) {
    resolved.maxOutputTokens = maxOutputTokens;
  }
  if (reasoning) {
    resolved.reasoning = reasoning;
  }
  return resolved;
}
