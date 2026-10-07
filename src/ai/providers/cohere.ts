// Cohere AiClient implementation, built from the plain REST endpoints
// documented at https://docs.cohere.com/reference/chat and
// https://docs.cohere.com/reference/list-models - verified to be callable
// via plain fetch without the cohere-ai SDK. New (no prior invokeCohere
// existed in commitMessage.ts). Cohere has no rate-limit headers to read
// (see providersConfig.ts hasApiRateLimits: false).

import type { AiClient, ModelListEntry } from "../aiClient";
import { fetchJson } from "./httpClient";

interface CohereChatResponse {
  message?: { content?: Array<{ type?: string; text?: string }> };
  finish_reason?: string;
}

interface CohereModelsResponse {
  models?: Array<{ name: string }>;
}

export class CohereClient implements AiClient {
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
    };

    const data = (await fetchJson("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as CohereChatResponse;

    const textBlocks = data.message?.content;
    if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
      const reason = data.finish_reason ? ` (finish_reason: ${data.finish_reason})` : "";
      throw new Error(`Cohere returned no usable content${reason}`);
    }

    return textBlocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("")
      .trim();
  }

  async listModels(): Promise<ModelListEntry[]> {
    const result = (await fetchJson("https://api.cohere.com/v1/models?page_size=200&endpoint=chat", {
      method: "GET",
      headers: this.headers(),
    })) as CohereModelsResponse;

    return (result.models || []).map((m) => ({ modelId: m.name, modelLabel: m.name }));
  }

  async checkConnection(): Promise<void> {
    await fetchJson("https://api.cohere.com/v1/models?page_size=1", { method: "GET", headers: this.headers() });
  }
}
