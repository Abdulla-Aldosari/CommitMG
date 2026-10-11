// Tests for the developer capability probe's reply summarizer. Pure.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { collectSignals, describeShape, extractProbeError, retryDelayMs, summarizeResponse } from "../src/dev/probe/probeResult";

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

  it("truncates long provider errors", () => {
    assert.ok(extractProbeError("x".repeat(1000)).length <= 403);
  });

  it("honors Retry-After and caps the delay", () => {
    assert.equal(retryDelayMs("2", 0), 2000);
    assert.equal(retryDelayMs("999", 0), 30000);
    assert.equal(retryDelayMs(null, 0), 5000);
  });
});
