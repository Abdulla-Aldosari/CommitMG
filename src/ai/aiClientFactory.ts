// The single gateway that decides where a request goes. Every other module
// (the generation engine, the settings panel) only ever sees the resulting
// AiClient - never a provider name, model id, or API key directly. This file
// is vscode-free: the "vscode" pathway's real vscode.lm access is injected
// through VsCodeLmAccessor (see vsCodeLmClient.ts), constructed in
// src/settings/vsCodeLmAccessorImpl.ts.

import type { AiClient, ModelListEntry } from "./aiClient";
import type { DirectProviderName } from "./providersConfig";
import { OPENAI_COMPATIBLE_BASE_URLS, OLLAMA_DEFAULT_BASE_URL, filterProviderModels, getDefaultModelId, getProviderConfig } from "./providersConfig";
import { GeminiClient } from "./providers/gemini";
import { OpenAiCompatibleClient } from "./providers/openaiCompatible";
import { OllamaClient } from "./providers/ollama";
import { AnthropicClient } from "./providers/anthropic";
import { MistralClient } from "./providers/mistral";
import { CohereClient } from "./providers/cohere";
import { VsCodeLmClient, type VsCodeLmAccessor } from "./vsCodeLmClient";

export interface DirectAiSelection {
  pathway: "direct";
  providerName: DirectProviderName;
  modelId: string;
  // Only meaningful (and required) when providerName === "custom".
  customBaseUrl?: string;
  // Only meaningful when providerName === "ollama"; the factory falls back
  // to OLLAMA_DEFAULT_BASE_URL when absent.
  ollamaBaseUrl?: string;
}

export interface VsCodeAiSelection {
  pathway: "vscode";
  // The vscode.lm model id previously chosen in settings; when absent the
  // first model returned by selectChatModels() is used.
  modelId?: string;
}

export type AiSelection = DirectAiSelection | VsCodeAiSelection;

// Builds the AiClient for the given selection. `apiKey` is ignored for the
// "vscode" pathway and for a "custom" provider with no key configured (some
// local servers, e.g. Ollama, require none). `vsCodeLm` is required only
// when selection.pathway === "vscode".
export function createAiClient(selection: AiSelection, apiKey: string | undefined, vsCodeLm?: VsCodeLmAccessor): AiClient {
  if (selection.pathway === "vscode") {
    if (!vsCodeLm) {
      throw new Error("VS Code Language Model accessor was not provided.");
    }
    return new VsCodeLmClient(vsCodeLm, selection.modelId);
  }

  const { providerName, modelId, customBaseUrl, ollamaBaseUrl } = selection;

  // A fixed provider with no model picked yet falls back to its configured
  // default model, honoring the documented "leave empty to use the
  // provider's default model" contract. The synthetic providers have no
  // config to fall back on and pass the id through as-is.
  const resolvedModelId = providerName === "custom" || providerName === "ollama" ? modelId : modelId || getDefaultModelId(providerName);

  switch (providerName) {
    case "gemini":
      return new GeminiClient(requireApiKey(apiKey, providerName), resolvedModelId);
    case "anthropic":
      return new AnthropicClient(requireApiKey(apiKey, providerName), resolvedModelId);
    case "mistral":
      return new MistralClient(requireApiKey(apiKey, providerName), resolvedModelId);
    case "cohere":
      return new CohereClient(requireApiKey(apiKey, providerName), resolvedModelId);
    case "openai":
    case "deepseek":
    case "groq":
    case "stepfun":
      return new OpenAiCompatibleClient(requireApiKey(apiKey, providerName), resolvedModelId, OPENAI_COMPATIBLE_BASE_URLS[providerName]!, providerName);
    case "custom": {
      if (!customBaseUrl) {
        throw new Error('A base URL is required for the "custom" provider.');
      }
      // No requireApiKey(): a custom endpoint (e.g. local Ollama) may need
      // no key at all; OpenAiCompatibleClient omits the Authorization
      // header when apiKey is empty.
      return new OpenAiCompatibleClient(apiKey ?? "", resolvedModelId, customBaseUrl, "custom");
    }
    case "ollama": {
      // Keyless by design: OllamaClient never sends an Authorization header.
      // An absent base URL falls back to Ollama's standard local address.
      return new OllamaClient(ollamaBaseUrl || OLLAMA_DEFAULT_BASE_URL, resolvedModelId);
    }
    default: {
      const exhaustiveCheck: never = providerName;
      throw new Error(`Unknown provider selection: ${String(exhaustiveCheck)}`);
    }
  }
}

function requireApiKey(apiKey: string | undefined, providerName: string): string {
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${providerName}". Open CommitMG Settings to add one.`);
  }
  return apiKey;
}

// Fetches and filters the live model list for one already-built client. The
// client carries its own providerName, so callers pass neither a provider
// name nor an API key here. Fixed direct providers go through the
// centralized filtering pipeline (filterProviderModels in
// providersConfig.ts); "custom" and "vscode" have no filter config and pass
// through unchanged.
export async function listModelsForProvider(client: AiClient): Promise<ModelListEntry[]> {
  if (!client.listModels) {
    throw new Error("This provider has no model list endpoint.");
  }
  const raw = await client.listModels();
  const config = getProviderConfig(client.providerName);
  return config ? filterProviderModels(config.name, raw) : raw;
}
