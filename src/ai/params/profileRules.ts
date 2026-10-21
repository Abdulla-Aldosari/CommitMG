// The neutral model-parameter facade every consumer already uses. The
// capability data itself no longer lives in code: the baseline table ships
// as capabilities.json (bundled into the extension), and during extension
// development the store can read it from the source file so capabilities
// merged by the Developer tab apply immediately. capabilityStore.ts owns the
// data and the matching; this file only keeps the public API.

import type { DirectProviderName } from "../providersConfig";
import { REASONING_LEVELS, type GenerationParams, type ReasoningLevel } from "./generationParams";
import { resolveParams, type ModelProfile, type ResolvedParams, type TemperatureSupport } from "./modelProfile";
import { providerDefaults as defaultsFor, resolveModelProfile as profileFor } from "./capabilityStore";

export { initializeCapabilityStore, reloadCapabilityStore } from "./capabilityStore";
export type { CapabilitiesFile, CapabilityRule, StoredModelProfile } from "./capabilityStore";
export type { ModelProfile } from "./modelProfile";

// What the settings UI may offer for one model: the reasoning levels it
// accepts (in REASONING_LEVELS order), whether it takes a temperature, and
// whether its profile is measured (known) or the provider fallback.
export interface ModelSupport {
  known: boolean;
  reasoningLevels: ReasoningLevel[];
  temperature: TemperatureSupport;
}

export function resolveModelProfile(providerName: DirectProviderName, modelId: string): ModelProfile {
  return profileFor(providerName, modelId);
}

export function modelSupport(providerName: DirectProviderName, modelId: string): ModelSupport {
  const profile = profileFor(providerName, modelId);
  const reasoningLevels = profile.reasoning.control === "none" ? [] : REASONING_LEVELS.filter((level) => profile.reasoning.levels[level] !== undefined);
  return { known: profile.known, reasoningLevels, temperature: profile.temperature };
}

export function providerDefaultParams(providerName: DirectProviderName): GenerationParams {
  return defaultsFor(providerName);
}

// The values one request to this model carries: the requested parameters
// over the provider defaults, minus everything the model's profile rejects.
export function resolveRequestParams(providerName: DirectProviderName, modelId: string, params: GenerationParams = {}): ResolvedParams {
  return resolveParams(params, defaultsFor(providerName), profileFor(providerName, modelId));
}
