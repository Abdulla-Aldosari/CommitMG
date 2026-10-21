// The single source of truth for model capabilities. The baseline table
// ships inside the extension bundle as capabilities.json (inlined by esbuild
// at build time); during extension development the store can instead read
// the source file on disk, so capabilities merged by the Developer tab apply
// without a rebuild. This module is vscode-free: the caller supplies the
// optional source path and file I/O uses node fs.

import * as fs from "fs";
import type { DirectProviderName } from "../providersConfig";
import type { GenerationParams, ReasoningLevel } from "./generationParams";
import type { ModelProfile, OutputCapField, ReasoningControl, TemperatureSupport } from "./modelProfile";
import baselineData from "./capabilities.json";

// The shape one capability profile has inside the JSON files. The runtime
// ModelProfile adds the derived "known" flag (true for a matched rule,
// false for the provider fallback).
export interface StoredReasoningProfile {
  control: ReasoningControl;
  levels: Partial<Record<ReasoningLevel, string | number | boolean>>;
  onByDefault: boolean;
}

export interface StoredModelProfile {
  id: string;
  reasoning: StoredReasoningProfile;
  temperature: TemperatureSupport;
  outputCapField: OutputCapField;
}

export interface CapabilityRule {
  ids: string[];
  profile: StoredModelProfile;
}

export interface ProviderCapabilities {
  rules: CapabilityRule[];
  fallback: StoredModelProfile;
  defaults: GenerationParams;
}

export type CapabilitiesFile = {
  version: number;
  providers: Partial<Record<DirectProviderName, Partial<ProviderCapabilities>>>;
};

// -2025-08-07, -20251101, -0613: a dated snapshot of a known model.
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

const REASONING_CONTROLS: readonly string[] = ["none", "effort", "level", "budget", "think"];
const REASONING_LEVEL_KEYS: readonly string[] = ["off", "low", "medium", "high", "max"];
const TEMPERATURE_VALUES: readonly string[] = ["supported", "unsupported", "onlyWhenReasoningOff"];
const OUTPUT_CAP_VALUES: readonly string[] = ["max_tokens", "max_completion_tokens"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validStoredProfile(value: unknown): value is StoredModelProfile {
  if (!isRecord(value) || typeof value.id !== "string") {
    return false;
  }
  const reasoning = value.reasoning;
  if (!isRecord(reasoning)) {
    return false;
  }
  if (!REASONING_CONTROLS.includes(String(reasoning.control))) {
    return false;
  }
  if (typeof reasoning.onByDefault !== "boolean") {
    return false;
  }
  if (!isRecord(reasoning.levels)) {
    return false;
  }
  for (const [key, native] of Object.entries(reasoning.levels)) {
    if (!REASONING_LEVEL_KEYS.includes(key)) {
      return false;
    }
    if (typeof native !== "string" && typeof native !== "number" && typeof native !== "boolean") {
      return false;
    }
  }
  if (!TEMPERATURE_VALUES.includes(String(value.temperature))) {
    return false;
  }
  if (!OUTPUT_CAP_VALUES.includes(String(value.outputCapField))) {
    return false;
  }
  return true;
}

function validRule(value: unknown): value is CapabilityRule {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.ids) || value.ids.some((id) => typeof id !== "string")) {
    return false;
  }
  return validStoredProfile(value.profile);
}

function validDefaults(value: unknown): value is GenerationParams {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "reasoning") {
      if (!REASONING_LEVEL_KEYS.includes(String(entry))) {
        return false;
      }
    } else if (key === "temperature" || key === "maxOutputTokens") {
      if (typeof entry !== "number") {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

// Parses and structurally validates one capabilities file. Invalid pieces
// are dropped; a file that fails as a whole resolves to null, so a corrupt
// file can never break capability resolution.
export function parseCapabilitiesFile(raw: string): CapabilitiesFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.providers)) {
    return null;
  }

  const providers: CapabilitiesFile["providers"] = {};
  for (const [name, section] of Object.entries(parsed.providers)) {
    if (!isRecord(section)) {
      continue;
    }
    const provider: Partial<ProviderCapabilities> = {};
    // Rules are kept even when empty, so a merge round-trip never drops a
    // provider's "rules": [] key from the file.
    if (Array.isArray(section.rules)) {
      provider.rules = section.rules.filter(validRule);
    }
    if (validStoredProfile(section.fallback)) {
      provider.fallback = section.fallback;
    }
    if (validDefaults(section.defaults)) {
      provider.defaults = (section.defaults ?? {}) as GenerationParams;
    }
    if (provider.rules || provider.fallback) {
      providers[name as DirectProviderName] = provider;
    }
  }
  return { version: 1, providers };
}

// The baseline table bundled into the extension. Re-parsed through the same
// validation as any external file, so an authoring mistake surfaces in tests
// instead of at a user's request time.
const baseline: CapabilitiesFile = parseCapabilitiesFile(JSON.stringify(baselineData)) ?? { version: 1, providers: {} };

// The optional source path (extension development only). When set, the store
// reads capabilities from that file instead of the bundled baseline.
let sourcePath: string | undefined;

export function initializeCapabilityStore(filePath?: string): void {
  sourcePath = filePath;
}

export function reloadCapabilityStore(): void {
  // Resolution reads the active file on every call; nothing is cached.
}

function readSourceFile(): CapabilitiesFile | null {
  if (!sourcePath) {
    return null;
  }
  try {
    return parseCapabilitiesFile(fs.readFileSync(sourcePath, "utf8"));
  } catch {
    return null;
  }
}

function activeFile(): CapabilitiesFile {
  return readSourceFile() ?? baseline;
}

// The provider fallback: what every unmeasured model of the provider gets.
// Never reached for the shipped schema, but keeps unknown providers safe.
const GENERIC_FALLBACK: StoredModelProfile = {
  id: "unknown",
  reasoning: { control: "none", levels: {}, onByDefault: false },
  temperature: "supported",
  outputCapField: "max_tokens",
};

function fallbackFor(file: CapabilitiesFile, providerName: DirectProviderName): StoredModelProfile {
  return file.providers[providerName]?.fallback ?? GENERIC_FALLBACK;
}

// Resolves one model's capability profile: the first matching rule of the
// active file (exact id, case-insensitive, or a dated snapshot through its
// undated id), else the provider fallback. "known" tells the settings UI
// whether the profile was measured or is the conservative fallback.
export function resolveModelProfile(providerName: DirectProviderName, modelId: string): ModelProfile {
  const file = activeFile();
  const id = modelId.trim().toLowerCase();
  const undated = id.replace(DATE_SUFFIX, "");
  const rules = file.providers[providerName]?.rules ?? [];
  const rule = rules.find((candidate) => candidate.ids.includes(id) || candidate.ids.includes(undated));
  if (rule) {
    return { ...rule.profile, known: true };
  }
  return { ...fallbackFor(file, providerName), known: false };
}

export function providerDefaults(providerName: DirectProviderName): GenerationParams {
  return activeFile().providers[providerName]?.defaults ?? {};
}

// Merges one measured rule into the raw text of a capabilities file: rules
// whose ids overlap the new rule are replaced, the new rule goes first, and
// every other provider and rule is kept verbatim. Pure, so the Developer tab
// and the unit tests share the exact same merge.
export function mergeRuleIntoCapabilitiesFile(raw: string, providerName: DirectProviderName, rule: CapabilityRule): string {
  const file = parseCapabilitiesFile(raw) ?? { version: 1, providers: {} };
  const section = file.providers[providerName] ?? {};
  const rules = section.rules ?? [];
  const ids = new Set(rule.ids);
  const kept = rules.filter((existing) => !existing.ids.some((id) => ids.has(id)));
  const next: CapabilitiesFile = {
    version: 1,
    providers: { ...file.providers, [providerName]: { ...section, rules: [rule, ...kept] } },
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}
