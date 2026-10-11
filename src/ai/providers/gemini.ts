// Gemini AiClient implementation: transport only. The request body and the
// reply reading live in the Gemini dialect (src/ai/dialects/geminiDialect.ts).
// Gemini has no rate-limit headers to read (see providersConfig.ts
// hasApiRateLimits).

import type { AiClient, CompletionOptions, ModelListEntry } from "../aiClient";
import { requireText } from "../dialects/dialect";
import { buildGeminiBody, extractGeminiText } from "../dialects/geminiDialect";
import { resolveRequestParams } from "../params/profileRules";
import { fetchJson } from "./httpClient";

interface GeminiModelsResponse {
  models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  nextPageToken?: string;
  error?: { message?: string };
}

export class GeminiClient implements AiClient {
  readonly providerName = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  // The key travels in the x-goog-api-key header, never in the URL: URLs end
  // up in error messages, notifications, and developer session logs.
  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey };
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`;
    const body = buildGeminiBody({ modelId: this.modelId, systemPrompt, userPrompt }, resolveRequestParams("gemini", this.modelId, options.params));

    const data = await fetchJson(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return requireText("Gemini", extractGeminiText(data));
  }

  async listModels(): Promise<ModelListEntry[]> {
    const allModels: ModelListEntry[] = [];
    let nextPageToken: string | null = null;

    do {
      const pageParam = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : "";
      const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100${pageParam}`;
      const result = (await fetchJson(url, { method: "GET", headers: this.headers() })) as GeminiModelsResponse;
      if (result.error) {
        throw new Error(result.error.message || "Gemini API error");
      }

      const models = (result.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => ({
          modelId: m.name.replace("models/", ""),
          modelLabel: m.displayName || m.name.replace("models/", ""),
        }));

      allModels.push(...models);
      nextPageToken = result.nextPageToken || null;
    } while (nextPageToken);

    return allModels;
  }

  async checkConnection(): Promise<void> {
    const url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
    const result = (await fetchJson(url, { method: "GET", headers: this.headers() })) as GeminiModelsResponse;
    if (result.error) {
      throw new Error(result.error.message || "Gemini API error");
    }
  }
}
