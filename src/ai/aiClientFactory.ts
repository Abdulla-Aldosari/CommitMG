// The single gateway that decides where a request goes. Every other module
// (commitMessage.ts, the settings panel) only ever sees the resulting
// AiClient - never a provider name, model id, or API key directly. This file
// is vscode-free: the "vscode" pathway's real vscode.lm access is injected
// through VsCodeLmAccessor (see vsCodeLmClient.ts), constructed in
// src/settings/vsCodeLmAccessorImpl.ts.

import type { AiClient } from "./aiClient";
import type { DirectProviderName } from "./providersConfig";
import { OPENAI_COMPATIBLE_BASE_URLS } from "./providersConfig";
import { GeminiClient } from "./providers/gemini";
import { OpenAiCompatibleClient } from "./providers/openaiCompatible";
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

  const { providerName, modelId, customBaseUrl } = selection;

  switch (providerName) {
    case "gemini":
      return new GeminiClient(requireApiKey(apiKey, providerName), modelId);
    case "anthropic":
      return new AnthropicClient(requireApiKey(apiKey, providerName), modelId);
    case "mistral":
      return new MistralClient(requireApiKey(apiKey, providerName), modelId);
    case "cohere":
      return new CohereClient(requireApiKey(apiKey, providerName), modelId);
    case "openai":
    case "deepseek":
    case "groq":
    case "stepfun":
      return new OpenAiCompatibleClient(requireApiKey(apiKey, providerName), modelId, OPENAI_COMPATIBLE_BASE_URLS[providerName]!, providerName);
    case "custom": {
      if (!customBaseUrl) {
        throw new Error('A base URL is required for the "custom" provider.');
      }
      // No requireApiKey(): a custom endpoint (e.g. local Ollama) may need
      // no key at all; OpenAiCompatibleClient omits the Authorization
      // header when apiKey is empty.
      return new OpenAiCompatibleClient(apiKey ?? "", modelId, customBaseUrl, "Custom provider");
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
