// Tests for the developer capability probe's reply summarizer. Pure.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import {
  classifyFailure,
  collectSignals,
  describeShape,
  extractProbeError,
  RATE_LIMIT_DEFAULT_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  rateLimitDelayMs,
  summarizeResponse,
} from "../src/dev/probe/probeResult";

describe("probe response summary", () => {
  it("records the reply shape without the reply text", () => {
    const shape = describeShape({ choices: [{ message: { content: "secret reply", reasoning: "thoughts" }, finish_reason: "stop" }] });
    assert.equal(shape["choices"], "array(1)");
    assert.equal(shape["choices[0].message.content"], "string");
    assert.equal(shape["choices[0].message.reasoning"], "string");
    assert.equal(JSON.stringify(shape).includes("secret reply"), false);
  });

  it("lists the block types of a content array", () => {
    const shape = describeShape({
      content: [
        { type: "thinking", thinking: "x" },
        { type: "text", text: "OK" },
      ],
    });
    assert.equal(shape["content[*].type"], "thinking|text");
  });

  it("collects finish reasons and token usage only", () => {
    const signals = collectSignals({ choices: [{ finish_reason: "length", message: { content: "OK" } }], usage: { prompt_tokens: 12, completion_tokens: 16 } });
    assert.deepEqual(signals, { "choices[0].finish_reason": "length", "usage.prompt_tokens": 12, "usage.completion_tokens": 16 });
  });

  it("classifies accepted, rejected, and rate-limited replies", () => {
    assert.equal(summarizeResponse("a", 200, '{"ok":true}', 5).status, "accepted");
    const rejected = summarizeResponse("b", 400, '{"error":{"message":"Unsupported parameter: temperature"}}', 5);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.error, "Unsupported parameter: temperature");
    assert.equal(summarizeResponse("c", 429, "slow down", 5).status, "rate_limited");
  });

  it("separates account and probe problems from real rejections", () => {
    assert.equal(summarizeResponse("a", 402, '{"error":{"message":"You exceeded your current quota"}}', 5).status, "billing_blocked");
    assert.equal(
      summarizeResponse("b", 400, '{"error":{"message":"Could not finish the message because max_tokens or model output limit was reached."}}', 5).status,
      "output_limit",
    );
    assert.equal(summarizeResponse("c", 400, '{"error":{"message":"Unsupported value: reasoning_effort"}}', 5).status, "rejected");
  });

  it("reclassifies outcomes stored by an older probe version", () => {
    assert.equal(classifyFailure(402, "You exceeded your current quota"), "billing_blocked");
    assert.equal(classifyFailure(400, "Could not finish the message because max_tokens or model output limit was reached."), "output_limit");
    assert.equal(classifyFailure(404, "The model has been deprecated"), "rejected");
  });

  it("times a rate-limit retry from the provider's hint, capped, with a default", () => {
    assert.equal(rateLimitDelayMs("4", undefined), 4000);
    assert.equal(rateLimitDelayMs(null, "Quota exceeded. Please retry in 23.3s."), 23300);
    assert.equal(rateLimitDelayMs("120", undefined), RATE_LIMIT_MAX_DELAY_MS);
    assert.equal(rateLimitDelayMs(null, "busy"), RATE_LIMIT_DEFAULT_DELAY_MS);
    assert.equal(rateLimitDelayMs("Wed, 21 Oct 2026 07:28:00 GMT", undefined), RATE_LIMIT_DEFAULT_DELAY_MS);
  });

  it("truncates long provider errors", () => {
    assert.ok(extractProbeError("x".repeat(1000)).length <= 403);
  });
});
