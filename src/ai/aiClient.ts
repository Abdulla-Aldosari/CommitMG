// The single contract commitMessage.ts depends on. It knows nothing about
// providers, models, API keys, or HTTP - it only calls complete() with the
// two prompt strings it already built and gets the generated text back.
// Everything else here (listModels/checkConnection/checkRateLimits) exists
// purely for the settings webview (Refresh models / Check Connection / Check
// Rate Limits buttons) and is never touched by commitMessage.ts.

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

export interface AiClient {
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
