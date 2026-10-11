// Mistral AI AiClient implementation, built from the plain REST endpoints
// documented at https://docs.mistral.ai/api/ (chat completions + list
// models) - verified to be callable via plain fetch without the
// @mistralai/mistralai SDK.

import type { AiClient, CompletionOptions, ModelListEntry, RateLimitInfo } from "../aiClient";
import { requireText } from "../dialects/dialect";
import { buildMistralBody, extractMistralText } from "../dialects/mistralDialect";
import { resolveRequestParams } from "../params/profileRules";
import { fetchJson, fetchJsonWithResponse, parseIntHeader } from "./httpClient";

const BASE_URL = "https://api.mistral.ai/v1";

interface MistralModelsResponse {
  data?: Array<{ id: string }>;
}

export class MistralClient implements AiClient {
  readonly providerName = "mistral" as const;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const body = buildMistralBody({ modelId: this.modelId, systemPrompt, userPrompt }, resolveRequestParams("mistral", this.modelId));

    const data = await fetchJson(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return requireText("Mistral", extractMistralText(data));
  }

  async listModels(): Promise<ModelListEntry[]> {
    const result = (await fetchJson(`${BASE_URL}/models`, { method: "GET", headers: this.headers() })) as MistralModelsResponse;
    return (result.data || []).map((m) => ({ modelId: m.id, modelLabel: m.id }));
  }

  async checkConnection(): Promise<void> {
    await fetchJson(`${BASE_URL}/models`, { method: "GET", headers: this.headers() });
  }

  async checkRateLimits(): Promise<RateLimitInfo> {
    const { response } = await fetchJsonWithResponse(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelId, messages: [{ role: "user", content: "Hi" }], max_tokens: 1 }),
    });

    return {
      limitRequests: parseIntHeader(response.headers, "x-ratelimit-limit-req-minute"),
      remainingRequests: parseIntHeader(response.headers, "x-ratelimit-remaining-req-minute"),
      limitTokens: parseIntHeader(response.headers, "x-ratelimit-limit-tokens-minute"),
      remainingTokens: parseIntHeader(response.headers, "x-ratelimit-remaining-tokens-minute"),
    };
  }
}
