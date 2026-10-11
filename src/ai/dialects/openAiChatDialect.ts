// The OpenAI chat completions wire format, shared by OpenAI, DeepSeek, Groq,
// StepFun, Mistral, and user-supplied compatible servers. Provider
// differences are small overrides: DeepSeek turns reasoning off through
// thinking {type: "disabled"}; every other provider sends reasoning_effort.

import type { DirectProviderName } from "../providersConfig";
import type { ResolvedParams } from "../params/modelProfile";
import { chatMessages, isRecord, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";

export function buildOpenAiChatBody(providerName: DirectProviderName, base: BaseRequest, params: ResolvedParams): JsonBody {
  const body: JsonBody = { model: base.modelId, messages: chatMessages(base) };
  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    body[params.outputCapField] = params.maxOutputTokens;
  }
  const reasoning = params.reasoning;
  if (reasoning?.control === "effort") {
    if (providerName === "deepseek" && reasoning.level === "off") {
      body.thinking = { type: "disabled" };
    } else {
      body.reasoning_effort = reasoning.native;
    }
  }
  return body;
}

// The finish reasons that mean the reply stopped at a limit: "length" is the
// output cap; Mistral also sends "model_length" when the model's context
// window filled up first.
const CUT_OFF_REASONS: ReadonlySet<string> = new Set(["length", "model_length"]);

// The finish reason of choices[0], shared with the Mistral dialect.
export function chatFinish(data: unknown): Pick<ExtractedText, "finishReason" | "cutOff"> {
  const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const finishReason = isRecord(choice) && typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return { finishReason, cutOff: finishReason !== undefined && CUT_OFF_REASONS.has(finishReason) };
}

// Reads choices[0].message.content. Reasoning text arrives in separate
// fields (reasoning, reasoning_content) and is never part of the message.
export function extractOpenAiChatText(data: unknown): ExtractedText {
  const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const finish = chatFinish(data);
  const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
  if (typeof content !== "string") {
    return { text: null, detail: finish.finishReason ? `finish_reason: ${finish.finishReason}` : undefined, ...finish };
  }
  return { text: content.trim(), ...finish };
}
