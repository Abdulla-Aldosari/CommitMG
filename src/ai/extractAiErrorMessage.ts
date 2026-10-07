// Extracts a clean, user-facing message from an AI provider error. Adapted
// from RunBox's lib/handlers.js extractAiErrorMessage(), but simplified for
// CommitMG's fetch-based clients: every provider.ts file here throws a
// plain Error whose .message already embeds "HTTP <status> from <url>:
// <body>" (see providers/httpClient.ts fetchJson()), so this function only
// needs to pull the provider's own JSON error message out of that body
// instead of unwrapping SDK-specific error shapes.

// Attempts to parse the JSON body embedded in a fetchJson()-thrown error
// message and read a nested { error: { message } } or { message } field,
// matching the common error envelope shape used by Gemini, OpenAI-compatible
// APIs, Anthropic, Mistral, and Cohere.
export function extractAiErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);

  const bodyMatch = rawMessage.match(/HTTP \d+ from [^:]+:\s*([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1].trim() : "";

  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
      const nestedMessage = parsed.error && typeof parsed.error.message === "string" ? parsed.error.message.trim() : "";
      if (nestedMessage) {
        return nestedMessage;
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Body was not JSON (e.g. an HTML error page) - fall through to the
      // raw message below.
    }
  }

  return rawMessage || "An unexpected error occurred. Please try again.";
}
