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
import { redactUrl } from "../ai/providers/httpClient";
import type { GenerationOptions } from "../generation/options";
import type { CommitStyle } from "../generation/types";
import {
  displayedSettingValue,
  isUserSettingKey,
  isValidUserSettingValue,
  optionsFromSettings,
  paramsFromSettings,
  planStoredEdit,
  settingSource,
  styleForButton,
  USER_SETTING_DEFAULTS,
  USER_SETTING_KEYS,
  timeoutMsFromSettings,
  type SettingLayer,
  type SettingSource,
  type UserSettingKey,
  type UserSettingsSnapshot,
} from "./userSettings";
import { VsCodeLmAccessorImpl } from "./vsCodeLmAccessorImpl";

const CONFIG_SECTION = "commitmg";
const SECRET_PREFIX = "commitmg.apiKey.";

export interface AiSettingsSnapshot {
  pathway: "vscode" | "direct";
  providerName: DirectProviderName;
  modelId: string;
  customBaseUrl: string;
  ollamaBaseUrl: string;
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
    ollamaBaseUrl: config.get<string>("aiOllamaBaseUrl", ""),
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
  if (settings.ollamaBaseUrl !== undefined) {
    writes.push(config.update("aiOllamaBaseUrl", settings.ollamaBaseUrl, vscode.ConfigurationTarget.Global));
  }
  if (settings.vsCodeModelId !== undefined) {
    writes.push(config.update("aiVsCodeModelId", settings.vsCodeModelId, vscode.ConfigurationTarget.Global));
  }
  await Promise.all(writes);
}

// ===================== SPEED & CONTEXT =====================

export interface UserSettingView {
  value: unknown;
  source: SettingSource;
}

// Reads every Speed & Context setting with the layer it comes from, for the
// settings tab. The effective value already includes VS Code's defaults.
export function readUserSettingsView(): Record<UserSettingKey, UserSettingView> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const view = {} as Record<UserSettingKey, UserSettingView>;
  for (const key of USER_SETTING_KEYS) {
    view[key] = { value: config.get(key, USER_SETTING_DEFAULTS[key]), source: settingSource(config.inspect(key)) };
  }
  return view;
}

function readUserSettings(): Partial<UserSettingsSnapshot> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const snapshot: Partial<Record<UserSettingKey, unknown>> = {};
  for (const key of USER_SETTING_KEYS) {
    snapshot[key] = config.get(key, USER_SETTING_DEFAULTS[key]);
  }
  return snapshot as Partial<UserSettingsSnapshot>;
}

export interface RunSettings {
  options: GenerationOptions;
  params: GenerationParams;
  autoCorrect: boolean;
  requestTimeoutMs: number;
}

// What one generation run was configured with, for the developer session
// record: the AI selection, every stored Speed & Context value with the
// layer it came from, and the settings the run derived from them. Holds no
// secret: the API key is never read here, and the custom and Ollama base
// URLs are reduced to their origin and path.
export interface RunSnapshot {
  selection: AiSettingsSnapshot;
  stored: Record<UserSettingKey, UserSettingView>;
  run: RunSettings;
}

export function readRunSnapshot(run: RunSettings): RunSnapshot {
  const selection = readAiSettings();
  return {
    selection: {
      ...selection,
      customBaseUrl: selection.customBaseUrl ? redactUrl(selection.customBaseUrl) : "",
      ollamaBaseUrl: selection.ollamaBaseUrl ? redactUrl(selection.ollamaBaseUrl) : "",
    },
    stored: readUserSettingsView(),
    run,
  };
}

// The style the Source Control button generates with, or null to ask.
export function readButtonStyle(): CommitStyle | null {
  return styleForButton(vscode.workspace.getConfiguration(CONFIG_SECTION).get("format.defaultDetail"));
}

// Everything one generation run takes from the user's Speed & Context
// settings: the prompt options, the model params, and the run behavior.
export function readRunSettings(): RunSettings {
  const settings = readUserSettings();
  return {
    options: optionsFromSettings(settings),
    params: paramsFromSettings(settings),
    autoCorrect: settings["generation.autoCorrect"] !== false,
    requestTimeoutMs: timeoutMsFromSettings(settings),
  };
}

const LAYER_TARGETS: Readonly<Record<SettingLayer, vscode.ConfigurationTarget>> = {
  user: vscode.ConfigurationTarget.Global,
  workspace: vscode.ConfigurationTarget.Workspace,
};

// Whether this window has a workspace (a folder or a workspace file), the
// only place the workspace layer can be written.
export function hasWorkspaceLayer(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

// Applies one user edit from the settings tab. Rejects unknown keys and
// invalid values (the webview is a trust boundary), switches a named preset
// to "custom" when one of its knobs is edited, and writes the whole edit to
// one layer (see planStoredEdit). A value that only repeats the default is
// removed from the user settings instead of stored.
export async function writeUserSetting(key: unknown, value: unknown): Promise<void> {
  if (!isUserSettingKey(key) || !isValidUserSettingValue(key, value)) {
    throw new Error(`Rejected an invalid value for setting "${String(key)}".`);
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  // One write at a time, in the planned order (the preset last), so the
  // settings never pass through a state that mixes old and new values.
  const lookup = (settingKey: UserSettingKey) => {
    const inspected = config.inspect(settingKey);
    return { source: settingSource(inspected), defaultValue: inspected?.defaultValue };
  };
  for (const write of planStoredEdit(readUserSettings(), key, value, lookup)) {
    await config.update(write.key, write.value, LAYER_TARGETS[write.layer]);
  }
}

// Sets a setting in this workspace's settings to the value its control shows
// (see displayedSettingValue), so the workspace keeps it whatever the user
// settings hold. Works for a setting that comes from the user settings or
// from the default; the user settings are never touched, so other
// workspaces are not affected. A setting the workspace already defines is
// left as it is.
export async function copySettingToWorkspace(key: unknown): Promise<void> {
  if (!isUserSettingKey(key)) {
    throw new Error(`Rejected a copy of unknown setting "${String(key)}".`);
  }
  if (!hasWorkspaceLayer()) {
    throw new Error("open a folder or workspace first.");
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  if (settingSource(config.inspect(key)) === "workspace") {
    return;
  }
  const value = displayedSettingValue(readUserSettings(), key);
  if (!isValidUserSettingValue(key, value)) {
    throw new Error(`The current value of "${key}" is not valid, so it was not copied.`);
  }
  await config.update(key, value, LAYER_TARGETS.workspace);
}

// Removes the value from the layer it comes from, so the next layer down
// (the user value under a workspace value, or the default) applies.
export async function resetUserSetting(key: unknown): Promise<void> {
  if (!isUserSettingKey(key)) {
    throw new Error(`Rejected a reset of unknown setting "${String(key)}".`);
  }
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const source = settingSource(config.inspect(key));
  if (source === "default") {
    return;
  }
  await config.update(key, undefined, LAYER_TARGETS[source]);
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
    ollamaBaseUrl: settings.providerName === "ollama" ? settings.ollamaBaseUrl : undefined,
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
