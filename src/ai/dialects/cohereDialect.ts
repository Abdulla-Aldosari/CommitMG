// The Cohere v2 chat wire format. Reasoning: "off" is thinking {type:
// "disabled"}; a level is thinking {type: "enabled", token_budget}.

import type { ResolvedParams } from "../params/modelProfile";
import { chatMessages, isRecord, joinTextBlocks, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";

export function buildCohereBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  const body: JsonBody = { model: base.modelId, messages: chatMessages(base) };
  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    body.max_tokens = params.maxOutputTokens;
  }
  const reasoning = params.reasoning;
  if (reasoning?.level === "off") {
    body.thinking = { type: "disabled" };
  } else if (reasoning?.control === "budget") {
    body.thinking = { type: "enabled", token_budget: reasoning.native };
  }
  return body;
}

// Reasoning models answer with a thinking block before the text block; only
// text blocks are joined.
export function extractCohereText(data: unknown): ExtractedText {
  const message = isRecord(data) ? data.message : undefined;
  const blocks = isRecord(message) ? message.content : undefined;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    const finishReason = isRecord(data) && typeof data.finish_reason === "string" ? data.finish_reason : undefined;
    return { text: null, detail: finishReason ? `finish_reason: ${finishReason}` : undefined };
  }
  return { text: joinTextBlocks(blocks) };
}
