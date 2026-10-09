// Mistral AI AiClient implementation, built from the plain REST endpoints
// documented at https://docs.mistral.ai/api/ (chat completions + list
// models) - verified to be callable via plain fetch without the
// @mistralai/mistralai SDK.

import type { AiClient, ModelListEntry, RateLimitInfo } from "../aiClient";
import { fetchJson, fetchJsonWithResponse, parseIntHeader } from "./httpClient";

const MAX_OUTPUT_TOKENS = 8192;
const BASE_URL = "https://api.mistral.ai/v1";

interface MistralChatResponse {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: string;
  }>;
}

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

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = {
      model: this.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    };

    const data = (await fetchJson(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as MistralChatResponse;

    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message || typeof choice.message.content !== "string") {
      const reason = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
      throw new Error(`Mistral returned no usable content${reason}`);
    }

    return choice.message.content.trim();
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
