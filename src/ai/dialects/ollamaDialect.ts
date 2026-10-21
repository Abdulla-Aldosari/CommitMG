// The Ollama native chat wire format (POST /api/chat). Unlike the OpenAI
// chat dialect, the output cap and the temperature travel inside the options
// object (num_predict / temperature), the reply is message.content, and the
// completion reason is done_reason instead of choices[0].finish_reason.

import type { ResolvedParams } from "../params/modelProfile";
import { chatMessages, isRecord, type BaseRequest, type ExtractedText, type JsonBody } from "./dialect";

export function buildOllamaChatBody(base: BaseRequest, params: ResolvedParams): JsonBody {
  const body: JsonBody = { model: base.modelId, messages: chatMessages(base), stream: false };
  const options: JsonBody = {};
  if (params.temperature !== undefined) {
    options.temperature = params.temperature;
  }
  if (params.maxOutputTokens !== undefined) {
    options.num_predict = params.maxOutputTokens;
  }
  if (Object.keys(options).length > 0) {
    body.options = options;
  }
  // Measured thinking control: think carries the model's own value (boolean
  // on/off or a model-defined level name).
  if (params.reasoning?.control === "think") {
    body.think = params.reasoning.native;
  }
  return body;
}

// done_reason "length" means generation stopped at the num_predict cap, so
// the reply is unfinished; "stop" is a natural end. Any other reason (e.g.
// "load") holds no usable text.
const CUT_OFF_REASONS: ReadonlySet<string> = new Set(["length"]);

export function extractOllamaChatText(data: unknown): ExtractedText {
  const doneReason = isRecord(data) && typeof data.done_reason === "string" ? data.done_reason : undefined;
  const content = isRecord(data) && isRecord(data.message) ? data.message.content : undefined;
  const finish = {
    finishReason: doneReason,
    cutOff: doneReason !== undefined && CUT_OFF_REASONS.has(doneReason),
  };
  if (typeof content !== "string") {
    return { text: null, detail: doneReason ? `done_reason: ${doneReason}` : undefined, ...finish };
  }
  return { text: content.trim(), ...finish };
}
