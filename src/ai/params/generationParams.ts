// Neutral generation parameters: what the user (or a default) asks for,
// independent of any provider's request format. Every field is optional; an
// absent field means "Auto": the model profile's default applies, and a
// profile without a default sends nothing for that parameter.

export const REASONING_LEVELS = ["off", "low", "medium", "high", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export interface GenerationParams {
  reasoning?: ReasoningLevel;
  temperature?: number;
  maxOutputTokens?: number;
}

// The output budget every request has used so far: generous enough for a
// thorough commit message, and for thinking models whose reasoning counts
// against it. Anthropic requires a cap on every request, so its dialect
// falls back to this value when none is resolved.
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// The temperature every provider that accepts one has used so far: low, so
// the message stays close to the diff.
export const DEFAULT_TEMPERATURE = 0.2;
