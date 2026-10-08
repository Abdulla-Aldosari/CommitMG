// Unit tests for extractAiErrorMessage (src/ai/extractAiErrorMessage.ts),
// which normalizes fetchJson()-thrown "HTTP <status> from <url>: <body>"
// errors into the provider's own message. The key regression covered here:
// https:// URLs contain colons, so the body extraction must not stop at the
// colon inside the URL (the old [^:]+ pattern did, and returned the raw
// HTTP message instead of the friendly provider text).
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { extractAiErrorMessage } from "../src/ai/extractAiErrorMessage";

describe("extractAiErrorMessage", () => {
  it("extracts the nested error.message from an https URL body", () => {
    const error = new Error(
      `HTTP 429 from https://api.openai.com/v1/chat/completions: { "error": { "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/." } }`,
    );
    assert.equal(
      extractAiErrorMessage(error),
      "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
    );
  });

  it("extracts the top-level message when there is no error envelope", () => {
    const error = new Error(`HTTP 400 from https://api.mistral.ai/v1/chat/completions: { "message": "Invalid request" }`);
    assert.equal(extractAiErrorMessage(error), "Invalid request");
  });

  it("returns a non-HTTP error message unchanged", () => {
    const error = new Error("OpenAI returned no usable content (finish_reason: length)");
    assert.equal(extractAiErrorMessage(error), "OpenAI returned no usable content (finish_reason: length)");
  });

  it("returns the raw message when the body is not JSON", () => {
    const error = new Error("HTTP 502 from https://api.openai.com/v1/models: <html>Bad Gateway</html>");
    assert.equal(extractAiErrorMessage(error), "HTTP 502 from https://api.openai.com/v1/models: <html>Bad Gateway</html>");
  });

  it("normalizes a non-Error value through String()", () => {
    assert.equal(extractAiErrorMessage("plain failure"), "plain failure");
  });
});
