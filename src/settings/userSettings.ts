// The CommitMG settings kept in VS Code (personal preferences, unlike the
// project rules): Speed & Context, Message Format, and bullet spacing.
// Their keys, the context presets, and how a stored snapshot becomes the
// generation options, model params, and message format one run uses. Pure
// and vscode-free; settingsStore.ts does the reading and writing.

import { REASONING_LEVELS, type GenerationParams, type ReasoningLevel } from "../ai/params/generationParams";
import {
  DEFAULT_GENERATION_OPTIONS,
  DIFF_CONTEXT_LINE_STEPS,
  excludePatternProblem,
  GENERATION_OPTION_RANGES,
  MAX_EXCLUDE_PATTERNS,
  normalizeAdditionalInstructions,
  normalizeOptions,
  type GenerationOptions,
} from "../generation/options";
import { REQUEST_TIMEOUT_MS } from "../generation/generate";
import { EMOJI_POSITIONS, type EmojiPosition } from "../generation/format/typeEmoji";
import type { TypeGuide } from "../generation/prompt/typeGuide";
import { BULLET_SPACINGS, CONVENTIONS, type BulletSpacing, type Convention } from "../generation/types";

export const CONTEXT_PRESETS = ["fast", "balanced", "thorough", "custom"] as const;
export type ContextPreset = (typeof CONTEXT_PRESETS)[number];
export type NamedPreset = Exclude<ContextPreset, "custom">;

// The knobs a preset sets. Editing one of them switches the preset to
// "custom", which reads the individual values instead.
export type PresetKnobs = Pick<GenerationOptions, "includeEvidence" | "evidenceBudget" | "diffBudget" | "diffContextLines" | "typeGuide">;

export const PRESET_KNOBS: Readonly<Record<NamedPreset, PresetKnobs>> = {
  fast: { includeEvidence: false, evidenceBudget: 16000, diffBudget: 12000, diffContextLines: 1, typeGuide: "compact" },
  balanced: { includeEvidence: true, evidenceBudget: 16000, diffBudget: 24000, diffContextLines: 3, typeGuide: "compact" },
  // The values every generation used before the presets existed.
  thorough: {
    includeEvidence: DEFAULT_GENERATION_OPTIONS.includeEvidence,
    evidenceBudget: DEFAULT_GENERATION_OPTIONS.evidenceBudget,
    diffBudget: DEFAULT_GENERATION_OPTIONS.diffBudget,
    diffContextLines: DEFAULT_GENERATION_OPTIONS.diffContextLines,
    typeGuide: DEFAULT_GENERATION_OPTIONS.typeGuide,
  },
};

export const DEFAULT_CONTEXT_PRESET: NamedPreset = "balanced";

// Every Speed & Context setting key (under the "commitmg" section) and the
// value type it holds. "auto" and null both mean "leave it to the model
// profile". These keys are declared in package.json with the same defaults.
export interface UserSettingsSnapshot {
  "context.preset": ContextPreset;
  "context.includeEvidence": boolean;
  "context.evidenceBudget": number;
  "context.diffBudget": number;
  "context.diffContextLines": number;
  "context.ignoreWhitespace": boolean;
  "context.excludePatterns": string[];
  "prompt.typeGuide": TypeGuide;
  "context.untrackedMaxFiles": number;
  "context.untrackedMaxBytes": number;
  "generation.autoCorrect": boolean;
  "generation.timeoutSeconds": number;
  "model.reasoning": ReasoningLevel | "auto";
  "model.temperature": number | null;
  "model.maxOutputTokens": number | null;
  // A personal layout preference, shown on the Rules tab; stored with the
  // other VS Code settings so it follows the user across repositories.
  "format.bulletSpacing": BulletSpacing;
  // Message Format tab.
  "format.additionalInstructions": string;
  "format.emojiPosition": EmojiPosition;
  "format.convention": Convention;
}

export type UserSettingKey = keyof UserSettingsSnapshot;

export const USER_SETTING_DEFAULTS: Readonly<UserSettingsSnapshot> = {
  "context.preset": DEFAULT_CONTEXT_PRESET,
  "context.includeEvidence": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].includeEvidence,
  "context.evidenceBudget": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].evidenceBudget,
  "context.diffBudget": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].diffBudget,
  "context.diffContextLines": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].diffContextLines,
  "context.ignoreWhitespace": DEFAULT_GENERATION_OPTIONS.ignoreWhitespace,
  "context.excludePatterns": [...DEFAULT_GENERATION_OPTIONS.excludePatterns],
  "prompt.typeGuide": PRESET_KNOBS[DEFAULT_CONTEXT_PRESET].typeGuide,
  "context.untrackedMaxFiles": DEFAULT_GENERATION_OPTIONS.untrackedMaxFiles,
  "context.untrackedMaxBytes": DEFAULT_GENERATION_OPTIONS.untrackedMaxBytes,
  "generation.autoCorrect": true,
  "generation.timeoutSeconds": REQUEST_TIMEOUT_MS / 1000,
  "model.reasoning": "auto",
  "model.temperature": null,
  "model.maxOutputTokens": null,
  "format.bulletSpacing": DEFAULT_GENERATION_OPTIONS.bulletSpacing,
  "format.additionalInstructions": DEFAULT_GENERATION_OPTIONS.additionalInstructions,
  "format.emojiPosition": DEFAULT_GENERATION_OPTIONS.emojiPosition,
  "format.convention": DEFAULT_GENERATION_OPTIONS.convention,
};

export const USER_SETTING_KEYS = Object.keys(USER_SETTING_DEFAULTS) as UserSettingKey[];

export const TIMEOUT_SECONDS_RANGE = { min: 15, max: 600 } as const;
export const TEMPERATURE_RANGE = { min: 0, max: 2 } as const;

// The per-request timeout of one run, in milliseconds; a malformed or
// out-of-range value falls back to the default.
export function timeoutMsFromSettings(settings: Partial<UserSettingsSnapshot>): number {
  const seconds = settings["generation.timeoutSeconds"];
  return inRange(seconds, TIMEOUT_SECONDS_RANGE) ? Math.round(seconds) * 1000 : REQUEST_TIMEOUT_MS;
}
export const MAX_OUTPUT_TOKENS_RANGE = { min: 256, max: 65536 } as const;

// Where a setting's effective value comes from, most specific first. Every
// Speed & Context setting is window-scoped, so VS Code reads it from the
// workspace or the user settings only, never from a folder.
export type SettingSource = "workspace" | "user" | "default";

// A settings layer the panel writes to.
export type SettingLayer = Exclude<SettingSource, "default">;

export interface InspectedValue<T> {
  globalValue?: T;
  workspaceValue?: T;
}

export function settingSource<T>(inspected: InspectedValue<T> | undefined): SettingSource {
  if (inspected?.workspaceValue !== undefined) {
    return "workspace";
  }
  if (inspected?.globalValue !== undefined) {
    return "user";
  }
  return "default";
}

// The layer an edit is written to: the one the effective value comes from,
// so the edit always takes effect. A workspace value overrides the user
// value, so writing a setting the workspace defines to the user settings
// would change nothing. A setting nobody set goes to the user settings.
export function writeLayerFor(source: SettingSource): SettingLayer {
  return source === "workspace" ? "workspace" : "user";
}

function isPreset(value: unknown): value is ContextPreset {
  return typeof value === "string" && (CONTEXT_PRESETS as readonly string[]).includes(value);
}

// The generation options of one run: a named preset's knobs, or the
// individual values for "custom". Anything malformed is normalized away.
export function optionsFromSettings(settings: Partial<UserSettingsSnapshot>): GenerationOptions {
  const preset = isPreset(settings["context.preset"]) ? settings["context.preset"] : DEFAULT_CONTEXT_PRESET;
  const knobs: Partial<PresetKnobs> =
    preset === "custom"
      ? {
          includeEvidence: settings["context.includeEvidence"],
          evidenceBudget: settings["context.evidenceBudget"],
          diffBudget: settings["context.diffBudget"],
          diffContextLines: settings["context.diffContextLines"],
          typeGuide: settings["prompt.typeGuide"],
        }
      : PRESET_KNOBS[preset];
  return normalizeOptions({
    ...knobs,
    ignoreWhitespace: settings["context.ignoreWhitespace"],
    excludePatterns: settings["context.excludePatterns"],
    untrackedMaxFiles: settings["context.untrackedMaxFiles"],
    untrackedMaxBytes: settings["context.untrackedMaxBytes"],
    bulletSpacing: settings["format.bulletSpacing"],
    additionalInstructions: settings["format.additionalInstructions"],
    emojiPosition: settings["format.emojiPosition"],
    convention: settings["format.convention"],
  });
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}

const KNOB_KEYS: Readonly<Record<keyof PresetKnobs, UserSettingKey>> = {
  includeEvidence: "context.includeEvidence",
  evidenceBudget: "context.evidenceBudget",
  diffBudget: "context.diffBudget",
  diffContextLines: "context.diffContextLines",
  typeGuide: "prompt.typeGuide",
};

const NUMERIC_CONTEXT_KEYS: Readonly<Partial<Record<UserSettingKey, keyof typeof GENERATION_OPTION_RANGES>>> = {
  "context.evidenceBudget": "evidenceBudget",
  "context.diffBudget": "diffBudget",
  "context.untrackedMaxFiles": "untrackedMaxFiles",
  "context.untrackedMaxBytes": "untrackedMaxBytes",
};

export function isUserSettingKey(key: unknown): key is UserSettingKey {
  return typeof key === "string" && (USER_SETTING_KEYS as readonly string[]).includes(key);
}

// Checks a value the webview asks to store. The webview is a trust
// boundary: only a known key with a value of the right type and range is
// ever written to the user's settings.
export function isValidUserSettingValue(key: UserSettingKey, value: unknown): boolean {
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
    case "generation.autoCorrect":
      return typeof value === "boolean";
    case "prompt.typeGuide":
      return value === "full" || value === "compact";
    case "format.bulletSpacing":
      return typeof value === "string" && (BULLET_SPACINGS as readonly string[]).includes(value);
    case "format.additionalInstructions":
      // Stored as typed; only text that normalizes to itself is accepted,
      // so what the tab shows is exactly what the prompt receives.
      return typeof value === "string" && normalizeAdditionalInstructions(value) === value;
    case "format.emojiPosition":
      return typeof value === "string" && (EMOJI_POSITIONS as readonly string[]).includes(value);
    case "format.convention":
      return typeof value === "string" && (CONVENTIONS as readonly string[]).includes(value);
    case "context.excludePatterns":
      return (
        Array.isArray(value) &&
        value.length <= MAX_EXCLUDE_PATTERNS &&
        value.every((pattern) => typeof pattern === "string" && excludePatternProblem(pattern) === null) &&
        new Set(value).size === value.length
      );
    case "generation.timeoutSeconds":
      return inRange(value, TIMEOUT_SECONDS_RANGE) && Number.isInteger(value);
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

export interface SettingWrite {
  key: UserSettingKey;
  value: unknown;
}

// The writes one user edit causes, in the order they must be applied.
// Editing a preset knob while a named preset is active switches to
// "custom" and copies the preset's other knobs, so nothing the user did not
// touch changes. Choosing "custom" in the preset control copies the current
// preset's knobs the same way. The preset is always written last: until it
// reads "custom", the named preset's values stay in effect, so no reader
// ever sees "custom" paired with knobs that are not written yet.
export function planSettingEdit(current: Partial<UserSettingsSnapshot>, key: UserSettingKey, value: unknown): SettingWrite[] {
  const preset = isPreset(current["context.preset"]) ? current["context.preset"] : DEFAULT_CONTEXT_PRESET;
  const isKnob = (Object.values(KNOB_KEYS) as UserSettingKey[]).includes(key);
  const switchesToCustom = preset !== "custom" && (isKnob || (key === "context.preset" && value === "custom"));
  if (!switchesToCustom) {
    return [{ key, value }];
  }
  const knobWrites = (Object.entries(KNOB_KEYS) as Array<[keyof PresetKnobs, UserSettingKey]>).map(([knob, settingKey]) => ({
    key: settingKey,
    value: settingKey === key ? value : PRESET_KNOBS[preset][knob],
  }));
  return [...knobWrites, { key: "context.preset", value: "custom" }];
}

// The model params of one run. "auto", null, and out-of-range values are
// left out, so the model profile's defaults apply.
export function paramsFromSettings(settings: Partial<UserSettingsSnapshot>): GenerationParams {
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
