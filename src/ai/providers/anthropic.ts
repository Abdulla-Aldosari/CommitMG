// Anthropic Claude AiClient implementation: transport only. The request body
// and the reply reading live in the Anthropic dialect
// (src/ai/dialects/anthropicDialect.ts).

import type { AiClient, CompletionOptions, ModelListEntry, RateLimitInfo } from "../aiClient";
import { buildAnthropicBody, extractAnthropicText } from "../dialects/anthropicDialect";
import { requireText } from "../dialects/dialect";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../params/generationParams";
import type { ResolvedParams } from "../params/modelProfile";
import { fetchJson, fetchJsonWithResponse, parseIntHeader } from "./httpClient";

const REQUEST_PARAMS: ResolvedParams = { outputCapField: "max_tokens", maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS };

interface AnthropicModelsResponse {
  data?: Array<{ id: string; display_name?: string }>;
}

export class AnthropicClient implements AiClient {
  readonly providerName = "anthropic" as const;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const body = buildAnthropicBody({ modelId: this.modelId, systemPrompt, userPrompt }, REQUEST_PARAMS);

    const data = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return requireText("Anthropic", extractAnthropicText(data));
  }

  async listModels(): Promise<ModelListEntry[]> {
    const result = (await fetchJson("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: this.headers(),
    })) as AnthropicModelsResponse;

    return (result.data || []).map((m) => ({ modelId: m.id, modelLabel: m.display_name || m.id }));
  }

  async checkConnection(): Promise<void> {
    await fetchJson("https://api.anthropic.com/v1/models?limit=1", { method: "GET", headers: this.headers() });
  }

  async checkRateLimits(): Promise<RateLimitInfo> {
    const { response } = await fetchJsonWithResponse("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.modelId, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
    });

    return {
      limitRequests: parseIntHeader(response.headers, "anthropic-ratelimit-requests-limit"),
      remainingRequests: parseIntHeader(response.headers, "anthropic-ratelimit-requests-remaining"),
      limitTokens: parseIntHeader(response.headers, "anthropic-ratelimit-tokens-limit"),
      remainingTokens: parseIntHeader(response.headers, "anthropic-ratelimit-tokens-remaining"),
    };
  }
}
