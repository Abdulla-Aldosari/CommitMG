// Tests for how the stored model settings are shown for the chosen model.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { reasoningView } from "../src/webview/modelParams";

describe("reasoningView", () => {
  it("shows an offered level as it is", () => {
    assert.deepEqual(reasoningView("high", ["off", "high"]), { value: "high", ignoredLevel: null });
  });

  it("shows Auto for a level the model does not offer, and names it", () => {
    assert.deepEqual(reasoningView("max", ["off", "high"]), { value: "auto", ignoredLevel: "max" });
    assert.deepEqual(reasoningView("low", []), { value: "auto", ignoredLevel: "low" });
  });

  it("shows Auto for Auto and for malformed values", () => {
    assert.deepEqual(reasoningView("auto", ["low"]), { value: "auto", ignoredLevel: null });
    assert.deepEqual(reasoningView(42, ["low"]), { value: "auto", ignoredLevel: null });
  });
});
