// The AiClient implementation for a local Ollama server, talking Ollama's
// native API: model listing via GET /api/tags and generation via
// POST /api/chat. A local Ollama server needs no API key, so no
// Authorization header is ever sent. Transport only: the request body and
// the reply reading live in the Ollama chat dialect
// (src/ai/dialects/ollamaDialect.ts).

import type { AiClient, CompletionOptions, ModelListEntry } from "../aiClient";
import { readReply } from "../dialects/dialect";
import { buildOllamaChatBody, extractOllamaChatText } from "../dialects/ollamaDialect";
import { resolveRequestParams } from "../params/profileRules";
import { fetchJson } from "./httpClient";

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export class OllamaClient implements AiClient {
  readonly providerName = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly modelId: string,
  ) {}

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  async complete(systemPrompt: string, userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    const params = resolveRequestParams("ollama", this.modelId, options.params);
    const body = buildOllamaChatBody({ modelId: this.modelId, systemPrompt, userPrompt }, params);
    options.trace?.onRequest?.({ modelId: this.modelId, body });

    const data = await fetchJson(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    return readReply("Ollama", data, extractOllamaChatText(data), options.trace);
  }

  async listModels(): Promise<ModelListEntry[]> {
    const result = (await fetchJson(`${this.baseUrl}/api/tags`, {
      method: "GET",
      headers: this.headers(),
    })) as OllamaTagsResponse;

    return (result.models || []).map((m) => ({ modelId: m.name, modelLabel: m.name }));
  }

  async checkConnection(): Promise<void> {
    await fetchJson(`${this.baseUrl}/api/tags`, { method: "GET", headers: this.headers() });
  }
}
