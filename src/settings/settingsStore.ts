// The only place besides extension.ts and vsCodeLmAccessorImpl.ts that
// imports vscode for the AI-settings feature. Reads/writes the non-secret
// selection (pathway, provider, model, custom base URL) through VS Code's
// configuration API, and the API key through context.secrets (never through
// configuration, so it never ends up in settings.json or synced settings).

import * as vscode from "vscode";
import type { AiSelection, DirectAiSelection, VsCodeAiSelection } from "../ai/aiClientFactory";
import { createAiClient } from "../ai/aiClientFactory";
import type { AiClient } from "../ai/aiClient";
import type { DirectProviderName } from "../ai/providersConfig";
import { getProvidersArray } from "../ai/providersConfig";
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
// each entry in the provider dropdown (RunBox's cs-key-badge pattern)
// without a round-trip per provider.
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
  return createAiClient(selection, apiKey);
}
