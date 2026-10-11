// The shared shape of a dialect: the pure translation between one provider
// wire format and the neutral request. buildBody() turns the prompts and the
// resolved parameters into the exact JSON body; extractText() pulls the
// message text out of a parsed reply, skipping every reasoning part. The
// clients own transport (URL, headers, fetch); the dialects own the bytes.

export type JsonBody = { [key: string]: unknown };

export interface BaseRequest {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
}

// The outcome of reading a reply. A null text means the reply had no usable
// answer; detail then names why (a finish reason or block reason) for the
// error message.
export interface ExtractedText {
  text: string | null;
  detail?: string;
  // The provider's own reason for ending the reply, exactly as sent.
  finishReason?: string;
  // True when that reason says the reply stopped at the output limit, so
  // any text it holds is unfinished.
  cutOff?: boolean;
}

// Returns the extracted text, or throws the error every client reports for
// a reply without a usable answer. A reply cut off at the output limit is
// rejected even when it holds text: it ends mid-message (often inside the
// model's reasoning), and inserting it would look like a real answer.
export function requireText(providerLabel: string, extracted: ExtractedText): string {
  if (extracted.cutOff) {
    throw new Error(
      `${providerLabel} stopped at the output limit before finishing the message (${extracted.finishReason}). Raise Maximum output or lower Reasoning in CommitMG Settings > Speed & Context.`,
    );
  }
  if (extracted.text === null) {
    const detail = extracted.detail ? ` (${extracted.detail})` : "";
    throw new Error(`${providerLabel} returned no usable content${detail}`);
  }
  return extracted.text;
}

export function chatMessages(base: BaseRequest): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: base.systemPrompt },
    { role: "user", content: base.userPrompt },
  ];
}

// Joins the text of every block whose type is "text"; thinking blocks and
// anything else are skipped. Shared by every format that answers with a
// typed block list (Anthropic, Cohere, Mistral reasoning replies).
export function joinTextBlocks(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { type: string; text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
