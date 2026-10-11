// The Gemini generateContent wire format. Reasoning is thinkingConfig with
// either thinkingBudget or thinkingLevel, never both in one request (the API
// rejects the pair).

import type { ResolvedParams } from "../params/modelProfile";
import { isRecord, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";

export function buildGeminiBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  const generationConfig: JsonBody = {};
  if (params.temperature !== undefined) {
    generationConfig.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = params.maxOutputTokens;
  }
  const reasoning = params.reasoning;
  if (reasoning?.control === "budget") {
    generationConfig.thinkingConfig = { thinkingBudget: reasoning.native };
  } else if (reasoning?.control === "level") {
    generationConfig.thinkingConfig = { thinkingLevel: reasoning.native };
  }
  return {
    system_instruction: { parts: [{ text: base.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: base.userPrompt }] }],
    generationConfig,
  };
}

// Joins every non-thought text part: long replies can arrive split across
// parts, and thought parts (thought: true) must be skipped. finishReason
// "MAX_TOKENS" means the reply hit maxOutputTokens, which includes thinking.
export function extractGeminiText(data: unknown): ExtractedText {
  const candidate = isRecord(data) && Array.isArray(data.candidates) ? data.candidates[0] : undefined;
  const finishReason = isRecord(candidate) && typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;
  const finish = { finishReason, cutOff: finishReason === "MAX_TOKENS" };
  const parts = isRecord(candidate) && isRecord(candidate.content) ? candidate.content.parts : undefined;
  if (!Array.isArray(parts)) {
    const feedback = isRecord(data) && isRecord(data.promptFeedback) ? data.promptFeedback.blockReason : undefined;
    const detail = typeof feedback === "string" ? `blocked: ${feedback}` : finishReason ? `finishReason: ${finishReason}` : undefined;
    return { text: null, detail, ...finish };
  }
  const text = parts
    .filter((part): part is { text: string } => isRecord(part) && typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
  return { text, ...finish };
}
