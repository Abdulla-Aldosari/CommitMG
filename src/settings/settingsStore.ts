// The only place besides extension.ts and vsCodeLmAccessorImpl.ts that
// imports vscode for the AI-settings feature. Reads/writes the non-secret
// selection (pathway, provider, model, custom base URL) through VS Code's
// configuration API, and the API key through context.secrets (never through
// configuration, so it never ends up in settings.json or synced settings).

import * as vscode from "vscode";
import type { AiSelection, DirectAiSelection, VsCodeAiSelection } from "../ai/aiClientFactory";
import { createAiClient, listModelsForProvider } from "../ai/aiClientFactory";
import type { AiClient } from "../ai/aiClient";
import type { DirectProviderName } from "../ai/providersConfig";
import { getProviderConfig, getProvidersArray } from "../ai/providersConfig";
import type { GenerationParams } from "../ai/params/generationParams";
import type { GenerationOptions } from "../generation/options";
import {
  isSpeedSettingKey,
  isValidSpeedValue,
  optionsFromSettings,
  paramsFromSettings,
  planSpeedEdit,
  settingSource,
  SPEED_SETTING_DEFAULTS,
  SPEED_SETTING_KEYS,
  timeoutMsFromSettings,
  type SettingSource,
  type SpeedSettingKey,
  type SpeedSettingsSnapshot,
} from "./speedSettings";
import { VsCodeLmAccessorImpl } from "./vsCodeLmAccessorImpl";

const CONFIG_SECTION = "commitmg";
const SECRET_PREFIX = "commitmg.apiKey.";

export interface AiSettingsSnapshot {
  pathway: "vscode" | "direct";
  providerName: DirectProviderName;
  modelId: string;
  customBaseUrl: string;
  vsCodeModelId: string;
}

// Reads the current non-secret selection from VS Code configuration,
// applying the same defaults package.json declares.
export function readAiSettings(): AiSettingsSnapshot {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    pathway: config.get<"vscode" | "direct">("aiPathway", "direct"),
    providerName: config.get<DirectProviderName>("aiProviderName", "gemini"),
    modelId: config.get<string>("aiModelId", ""),
    customBaseUrl: config.get<string>("aiCustomBaseUrl", ""),
    vsCodeModelId: config.get<string>("aiVsCodeModelId", ""),
  };
}

// Persists the non-secret selection to user (global) settings, so it
// follows the user across workspaces like the rest of CommitMG's
// configuration.
export async function writeAiSettings(settings: Partial<AiSettingsSnapshot>): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const writes: Array<Thenable<void>> = [];
  if (settings.pathway !== undefined) {
    writes.push(config.update("aiPathway", settings.pathway, vscode.ConfigurationTarget.Global));
  }
  if (settings.providerName !== undefined) {
    writes.push(config.update("aiProviderName", settings.providerName, vscode.ConfigurationTarget.Global));
  }
  if (settings.modelId !== undefined) {
    writes.push(config.update("aiModelId", settings.modelId, vscode.ConfigurationTarget.Global));
  }
  if (settings.customBaseUrl !== undefined) {
    writes.push(config.update("aiCustomBaseUrl", settings.customBaseUrl, vscode.ConfigurationTarget.Global));
  }
  if (settings.vsCodeModelId !== undefined) {
    writes.push(config.update("aiVsCodeModelId", settings.vsCodeModelId, vscode.ConfigurationTarget.Global));
  }
  await Promise.all(writes);
}

// ===================== SPEED & CONTEXT =====================

export interface SpeedSettingView {
  value: unknown;
  source: SettingSource;
}

// Reads every Speed & Context setting with the layer it comes from, for the
// settings tab. The effective value already includes VS Code's defaults.
export function readSpeedSettingsView(): Record<SpeedSettingKey, SpeedSettingView> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const view = {} as Record<SpeedSettingKey, SpeedSettingView>;
  for (const key of SPEED_SETTING_KEYS) {
    view[key] = { value: config.get(key, SPEED_SETTING_DEFAULTS[key]), source: settingSource(config.inspect(key)) };
  }
  return view;
}

function readSpeedSettings(): Partial<SpeedSettingsSnapshot> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const snapshot: Partial<Record<SpeedSettingKey, unknown>> = {};
  for (const key of SPEED_SETTING_KEYS) {
    snapshot[key] = config.get(key, SPEED_SETTING_DEFAULTS[key]);
  }
  return snapshot as Partial<SpeedSettingsSnapshot>;
}

// Everything one generation run takes from the user's Speed & Context
// settings: the prompt options, the model params, and the run behavior.
export function readRunSettings(): { options: GenerationOptions; params: GenerationParams; autoCorrect: boolean; requestTimeoutMs: number } {
  const settings = readSpeedSettings();
  return {
    options: optionsFromSettings(settings),
    params: paramsFromSettings(settings),
    autoCorrect: settings["generation.autoCorrect"] !== false,
    requestTimeoutMs: timeoutMsFromSettings(settings),
  };
}

// Applies one user edit from the settings tab. Rejects unknown keys and
// invalid values (the webview is a trust boundary), switches a named preset
// to "custom" when one of its knobs is edited, and writes user settings.
export async function writeSpeedSetting(key: unknown, value: unknown): Promise<void> {
  if (!isSpeedSettingKey(key) || !isValidSpeedValue(key, value)) {
    throw new Error(`Rejected an invalid value for setting "${String(key)}".`);
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const writes = planSpeedEdit(readSpeedSettings(), key, value);
  // Choosing Auto (null) for a setting whose default is Auto removes the
  // user value instead of storing a null that only repeats the default.
  await Promise.all(
    Object.entries(writes).map(([settingKey, settingValue]) => {
      const isAuto = settingValue === null && SPEED_SETTING_DEFAULTS[settingKey as SpeedSettingKey] === null;
      return config.update(settingKey, isAuto ? undefined : settingValue, vscode.ConfigurationTarget.Global);
    }),
  );
}

// Removes the user's value so the default (or a workspace value) applies.
export async function resetSpeedSetting(key: unknown): Promise<void> {
  if (!isSpeedSettingKey(key)) {
    throw new Error(`Rejected a reset of unknown setting "${String(key)}".`);
  }
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, undefined, vscode.ConfigurationTarget.Global);
}

export async function readApiKey(context: vscode.ExtensionContext, providerName: DirectProviderName): Promise<string | undefined> {
  return context.secrets.get(`${SECRET_PREFIX}${providerName}`);
}

export async function writeApiKey(context: vscode.ExtensionContext, providerName: DirectProviderName, apiKey: string): Promise<void> {
  await context.secrets.store(`${SECRET_PREFIX}${providerName}`, apiKey);
}

export async function deleteApiKey(context: vscode.ExtensionContext, providerName: DirectProviderName): Promise<void> {
  await context.secrets.delete(`${SECRET_PREFIX}${providerName}`);
}

// Reads the key-present/absent status for every fixed provider plus
// "custom", so the settings webview can render a colored key badge next to
// each entry in the provider dropdown without a round-trip per provider.
export async function readAllKeyStatuses(context: vscode.ExtensionContext): Promise<Record<DirectProviderName, boolean>> {
  const providerNames: DirectProviderName[] = [...getProvidersArray().map((p) => p.name), "custom"];
  const entries = await Promise.all(providerNames.map(async (name) => [name, Boolean(await readApiKey(context, name))] as const));
  return Object.fromEntries(entries) as Record<DirectProviderName, boolean>;
}

// Builds the AiSelection the factory needs from a settings snapshot.
export function toAiSelection(settings: AiSettingsSnapshot): AiSelection {
  if (settings.pathway === "vscode") {
    const vsCodeSelection: VsCodeAiSelection = { pathway: "vscode", modelId: settings.vsCodeModelId || undefined };
    return vsCodeSelection;
  }
  const directSelection: DirectAiSelection = {
    pathway: "direct",
    providerName: settings.providerName,
    modelId: settings.modelId,
    customBaseUrl: settings.providerName === "custom" ? settings.customBaseUrl : undefined,
  };
  return directSelection;
}

// Builds the ready-to-use AiClient for the currently configured selection.
// This is the single call site extension.ts needs before invoking
// generateCommitMessage().
export async function buildConfiguredAiClient(context: vscode.ExtensionContext): Promise<AiClient> {
  const settings = readAiSettings();
  const selection = toAiSelection(settings);

  if (selection.pathway === "vscode") {
    return createAiClient(selection, undefined, new VsCodeLmAccessorImpl());
  }

  const apiKey = await readApiKey(context, selection.providerName);

  // A fixed provider with no stored model yet: resolve one from the live
  // list (the provider's default when still listed, else the first live
  // model) so generation never relies on a stale static default. One extra
  // list request, only while no model is stored; the resolved id is then
  // persisted so the fetch never runs again. A failure (e.g. offline first
  // run) falls through to the gateway's static default resolution.
  if (selection.providerName !== "custom" && !selection.modelId) {
    try {
      const models = await listModelsForProvider(createAiClient(selection, apiKey));
      if (models.length > 0) {
        const config = getProviderConfig(selection.providerName);
        const defaultId = config ? config.defaultModelId : "";
        const target = models.some((m) => m.modelId === defaultId) ? defaultId : models[0].modelId;
        await writeAiSettings({ modelId: target });
        return createAiClient({ ...selection, modelId: target }, apiKey);
      }
    } catch {
      // Listing failed: proceed with the selection as-is; createAiClient
      // falls back to the static default model.
    }
  }

  return createAiClient(selection, apiKey);
}
