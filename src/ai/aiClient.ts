// The single contract commitMessage.ts depends on. It knows nothing about
// provider behavior, models, API keys, or HTTP - it only calls complete()
// with the two prompt strings it already built and gets the generated text
// back. Everything else here (providerName/listModels/checkConnection/
// checkRateLimits) exists purely for the settings webview (model filtering,
// Refresh models / Check Connection / Check Rate Limits buttons) and is
// never touched by commitMessage.ts.

import type { DirectProviderName } from "./providersConfig";

export interface ModelListEntry {
  modelId: string;
  modelLabel: string;
}

export interface RateLimitInfo {
  limitRequests?: number | null;
  remainingRequests?: number | null;
  limitTokens?: number | null;
  remainingTokens?: number | null;
  resetRequestsSeconds?: number | null;
  resetTokensSeconds?: number | null;
}

// The identity every client carries so the model-list flow can look up the
// provider's filtering rules without receiving the name separately: a fixed
// direct provider name, "custom", or "vscode".
export type AiClientProviderName = DirectProviderName | "vscode";

export interface AiClient {
  // Which provider this client was built for. Read only by the settings
  // flow's model filtering; commitMessage.ts never uses it.
  readonly providerName: AiClientProviderName;

  // Sends the two prompts and returns the trimmed response text. The only
  // method commitMessage.ts calls.
  complete(systemPrompt: string, userPrompt: string): Promise<string>;

  // Fetches the live model list from the provider's API. Absent on clients
  // that have no such endpoint (e.g. the VS Code Language Model pathway,
  // where the model list comes from vscode.lm.selectChatModels() instead).
  listModels?(): Promise<ModelListEntry[]>;

  // Performs a minimal request to verify the API key/connection is valid.
  // Throws on failure.
  checkConnection(): Promise<void>;

  // Reads rate-limit info from the provider's response headers. Absent on
  // providers that do not expose rate-limit headers (see
  // ProviderConfig.hasApiRateLimits in providersConfig.ts).
  checkRateLimits?(): Promise<RateLimitInfo>;
}
