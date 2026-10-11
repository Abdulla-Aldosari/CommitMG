// The Mistral chat completions wire format: the OpenAI chat body with
// reasoning_effort and max_tokens. The reply differs once a model reasons:
// message.content becomes a list of chunks, a "thinking" chunk (whose own
// text sits in a nested list) followed by "text" chunks. Some models
// (zai-glm) always answer with the chunk list.

import type { ResolvedParams } from "../params/modelProfile";
import { isRecord, joinTextBlocks, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";
import { buildOpenAiChatBody, chatFinish, extractOpenAiChatText } from "./openAiChatDialect";

export function buildMistralBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  return buildOpenAiChatBody("mistral", base, params);
}

// Joins the top-level text chunks only, so thinking text nested inside a
// thinking chunk never reaches the message. A chunk list with no text chunk
// (the model ran out of tokens while thinking) has no usable answer.
export function extractMistralText(data: unknown): ExtractedText {
  const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
  if (!Array.isArray(content)) {
    return extractOpenAiChatText(data);
  }
  const finish = chatFinish(data);
  const text = joinTextBlocks(content);
  if (text === "" && !content.some((chunk) => isRecord(chunk) && chunk.type === "text")) {
    return { text: null, detail: finish.finishReason ? `finish_reason: ${finish.finishReason}` : "only reasoning, no answer", ...finish };
  }
  return { text, ...finish };
}
