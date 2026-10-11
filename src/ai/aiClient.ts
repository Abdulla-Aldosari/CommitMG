// The single contract the generation engine (src/generation/) depends on. It knows nothing about
// provider behavior, models, API keys, or HTTP - it only calls complete()
// with the two prompt strings it already built and gets the generated text
// back. Everything else here (providerName/listModels/checkConnection/
// checkRateLimits) exists purely for the settings webview (model filtering,
// Refresh models / Check Connection / Check Rate Limits buttons) and is
// never touched by the generation engine.

import type { GenerationParams } from "./params/generationParams";
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

// How a client read one reply, reported before the text is checked, so a
// failed reply can still be recorded.
export interface CompletionReply {
  // The parsed response body, exactly as the provider sent it.
  body: unknown;
  // The provider's own reason for ending the reply, when it sends one.
  finishReason?: string;
  // True when the reply stopped at the output limit.
  cutOff: boolean;
}

// Optional hooks that let a caller record one exchange with the provider.
// Clients call them synchronously and never depend on what they do.
export interface CompletionTrace {
  // The exact JSON body, right before it is sent.
  onRequest?: (request: { modelId: string; body: unknown }) => void;
  // The parsed reply, right after it arrives.
  onReply?: (reply: CompletionReply) => void;
}

// Per-request options for complete().
export interface CompletionOptions {
  // Aborts the in-flight request. An aborted request rejects; callers check
  // signal.aborted to tell a cancellation from a failure.
  signal?: AbortSignal;
  // The user's reasoning, temperature, and output-cap choices. Each client
  // keeps only what the chosen model accepts (see src/ai/params/); absent
  // values use the provider defaults.
  params?: GenerationParams;
  // Records the request and the reply (developer diagnostics). The VS Code
  // Language Model pathway has no request body or reply body to report.
  trace?: CompletionTrace;
}

export interface AiClient {
  // Which provider this client was built for. Read only by the settings
  // flow's model filtering; the generation engine never uses it.
  readonly providerName: AiClientProviderName;

  // Sends the two prompts and returns the trimmed response text. The only
  // method the generation engine calls.
  complete(systemPrompt: string, userPrompt: string, options?: CompletionOptions): Promise<string>;

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
