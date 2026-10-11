// The Speed & Context settings: their keys, the context presets, and how a
// stored snapshot becomes the generation options and model params one run
// uses. Pure and vscode-free; settingsStore.ts does the reading and writing.

import { REASONING_LEVELS, type GenerationParams, type ReasoningLevel } from "../ai/params/generationParams";
import {
  DEFAULT_GENERATION_OPTIONS,
  DIFF_CONTEXT_LINE_STEPS,
  excludePatternProblem,
  GENERATION_OPTION_RANGES,
  MAX_EXCLUDE_PATTERNS,
  normalizeOptions,
  type GenerationOptions,
} from "../generation/options";

export const CONTEXT_PRESETS = ["fast", "balanced", "thorough", "custom"] as const;
export type ContextPreset = (typeof CONTEXT_PRESETS)[number];
export type NamedPreset = Exclude<ContextPreset, "custom">;

// The knobs a preset sets. Editing one of them switches the preset to
// "custom", which reads the individual values instead.
export type PresetKnobs = Pick<GenerationOptions, "includeEvidence" | "evidenceBudget" | "diffBudget" | "diffContextLines">;

export const PRESET_KNOBS: Readonly<Record<NamedPreset, PresetKnobs>> = {
  fast: { includeEvidence: false, evidenceBudget: 16000, diffBudget: 12000, diffContextLines: 1 },
  balanced: { includeEvidence: true, evidenceBudget: 16000, diffBudget: 24000, diffContextLines: 3 },
  // The values every generation used before the presets existed.
  thorough: {
    includeEvidence: DEFAULT_GENERATION_OPTIONS.includeEvidence,
    evidenceBudget: DEFAULT_GENERATION_OPTIONS.evidenceBudget,
    diffBudget: DEFAULT_GENERATION_OPTIONS.diffBudget,
    diffContextLines: DEFAULT_GENERATION_OPTIONS.diffContextLines,
  },
};

export const DEFAULT_CONTEXT_PRESET: NamedPreset = "balanced";

// Every Speed & Context setting key (under the "commitmg" section) and the
// value type it holds. "auto" and null both mean "leave it to the model
// profile". These keys are declared in package.json with the same defaults.
export interface SpeedSettingsSnapshot {
  "context.preset": ContextPreset;
  "context.includeEvidence": boolean;
  "context.evidenceBudget": number;
  "context.diffBudget": number;
  "context.diffContextLines": number;
  "context.ignoreWhitespace": boolean;
  "context.excludePatterns": string[];
  "context.untrackedMaxFiles": number;
  "context.untrackedMaxBytes": number;
  "model.reasoning": ReasoningLevel | "auto";
  "model.temperature": number | null;
  "model.maxOutputTokens": number | null;
}

export type SpeedSettingKey = keyof SpeedSettingsSnapshot;

export const SPEED_SETTING_DEFAULTS: Readonly<SpeedSettingsSnapshot> = {
  "context.preset": DEFAULT_CONTEXT_PRESET,
  "context.includeEvidence": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].includeEvidence,
  "context.evidenceBudget": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].evidenceBudget,
  "context.diffBudget": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].diffBudget,
  "context.diffContextLines": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].diffContextLines,
  "context.ignoreWhitespace": DEFAULT_GENERATION_OPTIONS.ignoreWhitespace,
  "context.excludePatterns": [...DEFAULT_GENERATION_OPTIONS.excludePatterns],
  "context.untrackedMaxFiles": DEFAULT_GENERATION_OPTIONS.untrackedMaxFiles,
  "context.untrackedMaxBytes": DEFAULT_GENERATION_OPTIONS.untrackedMaxBytes,
  "model.reasoning": "auto",
  "model.temperature": null,
  "model.maxOutputTokens": null,
};

export const SPEED_SETTING_KEYS = Object.keys(SPEED_SETTING_DEFAULTS) as SpeedSettingKey[];

export const TEMPERATURE_RANGE = { min: 0, max: 2 } as const;
export const MAX_OUTPUT_TOKENS_RANGE = { min: 256, max: 65536 } as const;

// Where a setting's effective value comes from, most specific first. The
// settings layers mirror VS Code's own precedence.
export type SettingSource = "workspaceFolder" | "workspace" | "user" | "default";

export interface InspectedValue<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export function settingSource<T>(inspected: InspectedValue<T> | undefined): SettingSource {
  if (inspected?.workspaceFolderValue !== undefined) {
    return "workspaceFolder";
  }
  if (inspected?.workspaceValue !== undefined) {
    return "workspace";
  }
  if (inspected?.globalValue !== undefined) {
    return "user";
  }
  return "default";
}

function isPreset(value: unknown): value is ContextPreset {
  return typeof value === "string" && (CONTEXT_PRESETS as readonly string[]).includes(value);
}

// The generation options of one run: a named preset's knobs, or the
// individual values for "custom". Anything malformed is normalized away.
export function optionsFromSettings(settings: Partial<SpeedSettingsSnapshot>): GenerationOptions {
  const preset = isPreset(settings["context.preset"]) ? settings["context.preset"] : DEFAULT_CONTEXT_PRESET;
  const knobs: Partial<PresetKnobs> =
    preset === "custom"
      ? {
          includeEvidence: settings["context.includeEvidence"],
          evidenceBudget: settings["context.evidenceBudget"],
          diffBudget: settings["context.diffBudget"],
          diffContextLines: settings["context.diffContextLines"],
        }
      : PRESET_KNOBS[preset];
  return normalizeOptions({
    ...knobs,
    ignoreWhitespace: settings["context.ignoreWhitespace"],
    excludePatterns: settings["context.excludePatterns"],
    untrackedMaxFiles: settings["context.untrackedMaxFiles"],
    untrackedMaxBytes: settings["context.untrackedMaxBytes"],
  });
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}

const KNOB_KEYS: Readonly<Record<keyof PresetKnobs, SpeedSettingKey>> = {
  includeEvidence: "context.includeEvidence",
  evidenceBudget: "context.evidenceBudget",
  diffBudget: "context.diffBudget",
  diffContextLines: "context.diffContextLines",
};

const NUMERIC_CONTEXT_KEYS: Readonly<Partial<Record<SpeedSettingKey, keyof typeof GENERATION_OPTION_RANGES>>> = {
  "context.evidenceBudget": "evidenceBudget",
  "context.diffBudget": "diffBudget",
  "context.untrackedMaxFiles": "untrackedMaxFiles",
  "context.untrackedMaxBytes": "untrackedMaxBytes",
};

export function isSpeedSettingKey(key: unknown): key is SpeedSettingKey {
  return typeof key === "string" && (SPEED_SETTING_KEYS as readonly string[]).includes(key);
}

// Checks a value the webview asks to store. The webview is a trust
// boundary: only a known key with a value of the right type and range is
// ever written to the user's settings.
export function isValidSpeedValue(key: SpeedSettingKey, value: unknown): boolean {
  if (key === "context.diffContextLines") {
    return typeof value === "number" && DIFF_CONTEXT_LINE_STEPS.includes(value);
  }
  const numericKey = NUMERIC_CONTEXT_KEYS[key];
  if (numericKey) {
    return inRange(value, GENERATION_OPTION_RANGES[numericKey]) && Number.isInteger(value);
  }
  switch (key) {
    case "context.preset":
      return isPreset(value);
    case "context.includeEvidence":
    case "context.ignoreWhitespace":
      return typeof value === "boolean";
    case "context.excludePatterns":
      return (
        Array.isArray(value) &&
        value.length <= MAX_EXCLUDE_PATTERNS &&
        value.every((pattern) => typeof pattern === "string" && excludePatternProblem(pattern) === null) &&
        new Set(value).size === value.length
      );
    case "model.reasoning":
      return value === "auto" || (typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value));
    case "model.temperature":
      return value === null || inRange(value, TEMPERATURE_RANGE);
    case "model.maxOutputTokens":
      return value === null || (inRange(value, MAX_OUTPUT_TOKENS_RANGE) && Number.isInteger(value));
    default:
      return false;
  }
}

// The writes one user edit causes. Editing a preset knob while a named
// preset is active switches to "custom" and copies the preset's other
// knobs, so nothing the user did not touch changes. Choosing "custom" in
// the preset control copies the current preset's knobs the same way.
export function planSpeedEdit(current: Partial<SpeedSettingsSnapshot>, key: SpeedSettingKey, value: unknown): Partial<Record<SpeedSettingKey, unknown>> {
  const preset = isPreset(current["context.preset"]) ? current["context.preset"] : DEFAULT_CONTEXT_PRESET;
  const isKnob = (Object.values(KNOB_KEYS) as SpeedSettingKey[]).includes(key);
  const switchesToCustom = preset !== "custom" && (isKnob || (key === "context.preset" && value === "custom"));
  if (!switchesToCustom) {
    return { [key]: value };
  }
  const copied: Partial<Record<SpeedSettingKey, unknown>> = { "context.preset": "custom" };
  for (const [knob, settingKey] of Object.entries(KNOB_KEYS) as Array<[keyof PresetKnobs, SpeedSettingKey]>) {
    copied[settingKey] = PRESET_KNOBS[preset][knob];
  }
  return key === "context.preset" ? copied : { ...copied, [key]: value };
}

// The model params of one run. "auto", null, and out-of-range values are
// left out, so the model profile's defaults apply.
export function paramsFromSettings(settings: Partial<SpeedSettingsSnapshot>): GenerationParams {
  const params: GenerationParams = {};
  const reasoning = settings["model.reasoning"];
  if (typeof reasoning === "string" && (REASONING_LEVELS as readonly string[]).includes(reasoning)) {
    params.reasoning = reasoning as ReasoningLevel;
  }
  if (inRange(settings["model.temperature"], TEMPERATURE_RANGE)) {
    params.temperature = settings["model.temperature"];
  }
  if (inRange(settings["model.maxOutputTokens"], MAX_OUTPUT_TOKENS_RANGE)) {
    params.maxOutputTokens = Math.round(settings["model.maxOutputTokens"]);
  }
  return params;
}
