// The Mistral chat completions wire format: the OpenAI chat body with
// reasoning_effort and max_tokens.

import type { ResolvedParams } from "../params/modelProfile";
import type { BaseRequest, ExtractedText, JsonBody } from "./dialect";
import { buildOpenAiChatBody, extractOpenAiChatText } from "./openAiChatDialect";

export function buildMistralBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  return buildOpenAiChatBody("mistral", base, params);
}

export function extractMistralText(data: unknown): ExtractedText {
  return extractOpenAiChatText(data);
}
