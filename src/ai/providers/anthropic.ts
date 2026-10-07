// Anthropic Claude AiClient implementation. The complete() body is the
// invokeAnthropic() previously embedded directly in commitMessage.ts, moved
// here unchanged; listModels()/checkConnection()/checkRateLimits() are new,
// minimal additions needed by the settings webview.

import type { AiClient, ModelListEntry, RateLimitInfo } from "../aiClient";
import { fetchJson, fetchJsonWithResponse, parseIntHeader } from "./httpClient";

const MAX_OUTPUT_TOKENS = 8192;

interface AnthropicResponse {
  content?: Array<{ type?: unknown; text?: unknown }>;
  stop_reason?: string;
}

interface AnthropicModelsResponse {
  data?: Array<{ id: string; display_name?: string }>;
}

export class AnthropicClient implements AiClient {
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

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = {
      model: this.modelId,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };

    const data = (await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as AnthropicResponse;

    const blocks = data.content;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      const reason = data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : "";
      throw new Error(`Anthropic returned no usable content${reason}`);
    }

    // Join every text block and skip thinking blocks: the answer can arrive
    // split across multiple blocks, and a thinking block must never be
    // mistaken for the message text.
    return blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("")
      .trim();
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
