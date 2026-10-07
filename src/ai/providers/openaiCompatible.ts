// One AiClient implementation shared by every OpenAI-compatible endpoint:
// openai, deepseek, groq, stepfun (all REST-identical to OpenAI's chat
// completions API) and the user-supplied "custom" provider (e.g. a local
// Ollama server). complete() is the invokeOpenAICompat()/invokeGroq() logic
// previously embedded in commitMessage.ts, moved here unchanged; the baseUrl
// is now a constructor parameter instead of being picked by a switch in
// commitMessage.ts.

import type { AiClient, ModelListEntry, RateLimitInfo } from "../aiClient";
import { fetchJson, fetchJsonWithResponse, parseIntHeader, parseDurationHeaderSeconds } from "./httpClient";

const MAX_OUTPUT_TOKENS = 8192;

interface OpenAICompatResponse {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: string;
  }>;
}

interface OpenAIModelsResponse {
  data?: Array<{ id: string }>;
}

export class OpenAiCompatibleClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
    private readonly baseUrl: string,
    // Used only in error messages, so failures point at the right provider
    // name (e.g. "Groq returned no usable content") even though the request
    // logic is shared.
    private readonly providerLabel: string,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
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

    const data = (await fetchJson(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as OpenAICompatResponse;

    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message || typeof choice.message.content !== "string") {
      const reason = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
      throw new Error(`${this.providerLabel} returned no usable content${reason}`);
    }

    return choice.message.content.trim();
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
