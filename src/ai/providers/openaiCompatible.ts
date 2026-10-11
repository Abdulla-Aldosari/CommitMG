// One AiClient implementation shared by every OpenAI-compatible endpoint:
// openai, deepseek, groq, stepfun (all REST-identical to OpenAI's chat
// completions API) and the user-supplied "custom" provider (e.g. a local
// Ollama server). Transport only: the request body and the reply reading
// live in the OpenAI chat dialect (src/ai/dialects/openAiChatDialect.ts).

import type { AiClient, CompletionOptions, ModelListEntry, RateLimitInfo } from "../aiClient";
import { requireText } from "../dialects/dialect";
import { buildOpenAiChatBody, extractOpenAiChatText } from "../dialects/openAiChatDialect";
import { resolveRequestParams } from "../params/profileRules";
import type { DirectProviderName } from "../providersConfig";
import { fetchJson, fetchJsonWithResponse, parseIntHeader, parseDurationHeaderSeconds } from "./httpClient";

interface OpenAIModelsResponse {
  data?: Array<{ id: string }>;
}

export class OpenAiCompatibleClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
    private readonly baseUrl: string,
    // One of openai/deepseek/groq/stepfun/custom. Exposed to the model-list
    // flow for filter lookup and used (via providerLabel) in error messages
    // so failures point at the right provider name even though the request
    // logic is shared.
    readonly providerName: DirectProviderName,
  ) {}

  // Display label for error messages (e.g. "Groq returned no usable
  // content"); "custom" gets a friendlier label than its technical name.
  private get providerLabel(): string {
    return this.providerName === "custom" ? "Custom provider" : this.providerName;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const params = resolveRequestParams(this.providerName, this.modelId, options.params);
    const body = buildOpenAiChatBody(this.providerName, { modelId: this.modelId, systemPrompt, userPrompt }, params);

    const data = await fetchJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return requireText(this.providerLabel, extractOpenAiChatText(data));
  }

  async listModels(): Promise<ModelListEntry[]> {
    const result = (await fetchJson(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.headers(),
    })) as OpenAIModelsResponse;

    return (result.data || []).map((m) => ({ modelId: m.id, modelLabel: m.id }));
  }

  async checkConnection(): Promise<void> {
    await fetchJson(`${this.baseUrl}/models`, { method: "GET", headers: this.headers() });
  }

  async checkRateLimits(): Promise<RateLimitInfo> {
    const { response } = await fetchJsonWithResponse(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelId, messages: [{ role: "user", content: "Hi" }], max_tokens: 1 }),
    });

    return {
      limitRequests: parseIntHeader(response.headers, "x-ratelimit-limit-requests"),
      remainingRequests: parseIntHeader(response.headers, "x-ratelimit-remaining-requests"),
      limitTokens: parseIntHeader(response.headers, "x-ratelimit-limit-tokens"),
      remainingTokens: parseIntHeader(response.headers, "x-ratelimit-remaining-tokens"),
      resetRequestsSeconds: parseDurationHeaderSeconds(response.headers, "x-ratelimit-reset-requests"),
      resetTokensSeconds: parseDurationHeaderSeconds(response.headers, "x-ratelimit-reset-tokens"),
    };
  }
}
