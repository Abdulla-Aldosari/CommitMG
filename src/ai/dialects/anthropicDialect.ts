// The Anthropic Messages wire format. max_tokens is required on every
// request. Reasoning: "off" is thinking {type: "disabled"}; an effort level
// is output_config.effort; a budget level is thinking {type: "enabled",
// budget_tokens}.

import { DEFAULT_MAX_OUTPUT_TOKENS } from "../params/generationParams";
import type { ResolvedParams } from "../params/modelProfile";
import { isRecord, joinTextBlocks, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";

export function buildAnthropicBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  const body: JsonBody = {
    model: base.modelId,
    max_tokens: params.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: base.systemPrompt,
    messages: [{ role: "user", content: base.userPrompt }],
  };
  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }
  const reasoning = params.reasoning;
  if (reasoning?.level === "off") {
    body.thinking = { type: "disabled" };
  } else if (reasoning?.control === "effort") {
    body.output_config = { effort: reasoning.native };
  } else if (reasoning?.control === "budget") {
    body.thinking = { type: "enabled", budget_tokens: reasoning.native };
  }
  return body;
}

// Joins every text block and skips thinking blocks: the answer can arrive
// split across blocks, and a thinking block must never be mistaken for the
// message.
export function extractAnthropicText(data: unknown): ExtractedText {
  const blocks = isRecord(data) ? data.content : undefined;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    const stopReason = isRecord(data) && typeof data.stop_reason === "string" ? data.stop_reason : undefined;
    return { text: null, detail: stopReason ? `stop_reason: ${stopReason}` : undefined };
  }
  return { text: joinTextBlocks(blocks) };
}
