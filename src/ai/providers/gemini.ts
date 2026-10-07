// Gemini AiClient implementation. The complete() body is the invokeGemini()
// previously embedded directly in commitMessage.ts, moved here unchanged;
// listModels()/checkConnection() are new, minimal additions needed by the
// settings webview's Refresh models / Check Connection buttons. Gemini has
// no rate-limit headers to read (see providersConfig.ts hasApiRateLimits).

import type { AiClient, ModelListEntry } from "../aiClient";
import { fetchJson } from "./httpClient";

// Shared output budget: generous enough for a thorough commit message (and
// for thinking models, whose internal reasoning consumes part of it)
// without leaving the door wide open.
const MAX_OUTPUT_TOKENS = 8192;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

interface GeminiModelsResponse {
  models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  nextPageToken?: string;
  error?: { message?: string };
}

export class GeminiClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent?key=${this.apiKey}`;
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Some Gemini models are thinking models whose internal reasoning
        // tokens count against maxOutputTokens. Disabling thinking keeps the
        // whole output budget for the commit message (also faster/cheaper).
        thinkingConfig: { thinkingBudget: 4096 },
      },
    };

    const data = (await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })) as GeminiResponse;

    const candidate = data.candidates && data.candidates[0];

    if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
      const blockReason = data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : "";
      throw new Error(`Gemini returned no usable content${blockReason}`);
    }

    // Join every non-thought text part: long responses can arrive split
    // across multiple parts, and thinking parts (thought: true) must be
    // skipped.
    return candidate.content.parts
      .filter((part) => typeof part.text === "string" && !part.thought)
      .map((part) => part.text as string)
      .join("")
      .trim();
  }

  async listModels(): Promise<ModelListEntry[]> {
    const allModels: ModelListEntry[] = [];
    let nextPageToken: string | null = null;

    do {
      let url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${this.apiKey}`;
      if (nextPageToken) {
        url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
      }
      const result = (await fetchJson(url, { method: "GET" })) as GeminiModelsResponse;
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${this.apiKey}`;
    const result = (await fetchJson(url, { method: "GET" })) as GeminiModelsResponse;
    if (result.error) {
      throw new Error(result.error.message || "Gemini API error");
    }
  }
}
