// Turns one model's probe outcomes into a stored capability profile, so the
// Developer tab can merge measured capabilities into capabilities.json with
// no hand-written code. Mechanical and conservative: a value is mapped only
// when its probe case was accepted; anything unmeasured stays absent, and
// the provider fallback keeps covering what the run could not tell.

import type { CapField, ProbeTarget } from "./probeCases";
import type { ProbeOutcome } from "./probeResult";
import type { StoredModelProfile } from "../../ai/params/capabilityStore";
import type { ReasoningLevel } from "../../ai/params/generationParams";

const NO_REASONING: StoredModelProfile["reasoning"] = { control: "none", levels: {}, onByDefault: false };

export function profileFromOutcomes(target: ProbeTarget, capField: CapField | null, outcomes: readonly ProbeOutcome[]): StoredModelProfile | null {
  if (capField === null) {
    return null;
  }
  switch (target.wireFormat) {
    case "openai-chat":
    case "mistral":
      return openAiStyleProfile(target, capField, outcomes);
    case "anthropic":
      return anthropicProfile(target, capField, outcomes);
    case "gemini":
      return geminiProfile(target, capField, outcomes);
    case "cohere":
      return cohereProfile(target, capField, outcomes);
    default: {
      const exhaustiveCheck: never = target.wireFormat;
      throw new Error(`Unknown wire format: ${String(exhaustiveCheck)}`);
    }
  }
}

function acceptedBy(outcomes: readonly ProbeOutcome[], caseId: string): boolean {
  return outcomes.some((o) => o.caseId === caseId && o.status === "accepted");
}

// Reasoning fields present in the default reply's shape mean the model
// thinks unless told otherwise. The check matches provider-specific names:
// reasoning/reasoning_content fields (OpenAI-style, Mistral, Cohere),
// thinking blocks (Anthropic's content[*].type), and thought parts (Gemini's
// parts[N].thought).
function reasonsByDefault(outcomes: readonly ProbeOutcome[]): boolean {
  const shape = outcomes.find((o) => o.caseId === "shape-default" && o.status === "accepted")?.shape;
  if (!shape) {
    return false;
  }
  return Object.keys(shape).some((key) => key.includes("reasoning") || (key.endsWith("[*].type") && shape[key].includes("thinking")) || key.includes(".thought"));
}

function temperatureFrom(outcomes: readonly ProbeOutcome[], comboCaseIds: readonly string[]): StoredModelProfile["temperature"] {
  if (acceptedBy(outcomes, "temperature-0.2")) {
    return "supported";
  }
  if (comboCaseIds.some((caseId) => acceptedBy(outcomes, caseId))) {
    return "onlyWhenReasoningOff";
  }
  return "unsupported";
}

function build(providerName: string, reasoning: StoredModelProfile["reasoning"], temperature: StoredModelProfile["temperature"], outputCapField: CapField): StoredModelProfile {
  return { id: `${providerName}-measured`, reasoning, temperature, outputCapField };
}

type Levels = Partial<Record<ReasoningLevel, string | number>>;

const EFFORT_VALUES: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORT_TO_LEVEL: Readonly<Record<string, ReasoningLevel>> = {
  none: "off",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
};

// Maps the accepted effort cases to neutral levels. "minimal" only counts
// when the provider's own "low" was not accepted (both name the same
// neutral level).
function effortLevels(outcomes: readonly ProbeOutcome[]): Levels {
  const levels: Levels = {};
  const lowAccepted = acceptedBy(outcomes, "reasoning-effort-low");
  for (const value of EFFORT_VALUES) {
    if (value === "minimal" && lowAccepted) {
      continue;
    }
    if (acceptedBy(outcomes, `reasoning-effort-${value}`)) {
      levels[EFFORT_TO_LEVEL[value]] = value;
    }
  }
  return levels;
}

// OpenAI-style (openai, deepseek, groq, stepfun, custom) and Mistral.
function openAiStyleProfile(target: ProbeTarget, capField: CapField, outcomes: readonly ProbeOutcome[]): StoredModelProfile {
  const levels = effortLevels(outcomes);
  // DeepSeek turns reasoning off through thinking {type: "disabled"}.
  if (target.providerName === "deepseek" && acceptedBy(outcomes, "thinking-disabled") && levels.off === undefined) {
    levels.off = "disabled";
  }
  const reasoning = Object.keys(levels).length > 0 ? { control: "effort" as const, levels, onByDefault: reasonsByDefault(outcomes) } : NO_REASONING;
  const comboCaseIds = target.providerName === "deepseek" ? ["reasoning-none-temperature", "thinking-disabled-temperature"] : ["reasoning-none-temperature"];
  return build(target.providerName, reasoning, temperatureFrom(outcomes, comboCaseIds), capField);
}

const ANTHROPIC_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];
const ANTHROPIC_TO_LEVEL: Readonly<Record<string, ReasoningLevel>> = { low: "low", medium: "medium", high: "high", xhigh: "max", max: "max" };

function anthropicProfile(target: ProbeTarget, capField: CapField, outcomes: readonly ProbeOutcome[]): StoredModelProfile {
  const levels: Levels = {};
  for (const value of ANTHROPIC_EFFORTS) {
    if (acceptedBy(outcomes, `effort-${value}`)) {
      levels[ANTHROPIC_TO_LEVEL[value]] = value;
    }
  }
  const off = acceptedBy(outcomes, "thinking-disabled");
  let reasoning: StoredModelProfile["reasoning"] = NO_REASONING;
  if (Object.keys(levels).length > 0) {
    reasoning = { control: "effort", levels: off ? { off: "disabled", ...levels } : levels, onByDefault: reasonsByDefault(outcomes) };
  } else if (acceptedBy(outcomes, "thinking-enabled-budget")) {
    reasoning = { control: "budget", levels: { ...(off ? { off: 0 } : {}), low: 1024 }, onByDefault: reasonsByDefault(outcomes) };
  }
  return build(target.providerName, reasoning, temperatureFrom(outcomes, ["thinking-adaptive-temperature"]), capField);
}

const GEMINI_LEVELS: readonly string[] = ["minimal", "low", "medium", "high"];
const GEMINI_TO_LEVEL: Readonly<Record<string, ReasoningLevel>> = { minimal: "low", low: "low", medium: "medium", high: "high" };

function geminiProfile(target: ProbeTarget, capField: CapField, outcomes: readonly ProbeOutcome[]): StoredModelProfile {
  const levels: Levels = {};
  const lowAccepted = acceptedBy(outcomes, "thinking-level-low");
  for (const value of GEMINI_LEVELS) {
    if (value === "minimal" && lowAccepted) {
      continue;
    }
    if (acceptedBy(outcomes, `thinking-level-${value}`)) {
      levels[GEMINI_TO_LEVEL[value]] = value;
    }
  }
  const budgetLevels: Levels = {};
  if (acceptedBy(outcomes, "thinking-budget-0")) {
    budgetLevels.off = 0;
  }
  if (acceptedBy(outcomes, "thinking-budget-1024")) {
    budgetLevels.low = 1024;
  }
  if (acceptedBy(outcomes, "thinking-budget-dynamic")) {
    budgetLevels.medium = -1;
  }
  // Gemini 3.x models accept both forms; the level form is preferred.
  const reasoning: StoredModelProfile["reasoning"] =
    Object.keys(levels).length > 0
      ? { control: "level", levels, onByDefault: reasonsByDefault(outcomes) }
      : Object.keys(budgetLevels).length > 0
        ? { control: "budget", levels: budgetLevels, onByDefault: reasonsByDefault(outcomes) }
        : NO_REASONING;
  return build(target.providerName, reasoning, temperatureFrom(outcomes, []), capField);
}

function cohereProfile(target: ProbeTarget, capField: CapField, outcomes: readonly ProbeOutcome[]): StoredModelProfile {
  const levels: Levels = {};
  if (acceptedBy(outcomes, "thinking-disabled")) {
    levels.off = 0;
  }
  if (acceptedBy(outcomes, "thinking-budget")) {
    levels.low = 1024;
  }
  const reasoning = Object.keys(levels).length > 0 ? { control: "budget" as const, levels, onByDefault: reasonsByDefault(outcomes) } : NO_REASONING;
  return build(target.providerName, reasoning, temperatureFrom(outcomes, []), capField);
}
