// Cohere AiClient implementation, built from the plain REST endpoints
// documented at https://docs.cohere.com/reference/chat and
// https://docs.cohere.com/reference/list-models - verified to be callable
// via plain fetch without the cohere-ai SDK. New (no prior invokeCohere
// existed in commitMessage.ts). Cohere has no rate-limit headers to read
// (see providersConfig.ts hasApiRateLimits: false).

import type { AiClient, CompletionOptions, ModelListEntry } from "../aiClient";
import { buildCohereBody, extractCohereText } from "../dialects/cohereDialect";
import { requireText } from "../dialects/dialect";
import { resolveRequestParams } from "../params/profileRules";
import { fetchJson } from "./httpClient";

interface CohereModelsResponse {
  models?: Array<{ name: string }>;
}

export class CohereClient implements AiClient {
  readonly providerName = "cohere" as const;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const body = buildCohereBody({ modelId: this.modelId, systemPrompt, userPrompt }, resolveRequestParams("cohere", this.modelId, options.params));

    const data = await fetchJson("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return requireText("Cohere", extractCohereText(data));
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
