// Tests for the prompt size line of the Speed & Context tab.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { promptSizeKey, promptSizeView } from "../src/webview/promptSize";

describe("promptSizeView", () => {
  it("states the measured size, the repository, and the style", () => {
    assert.deepEqual(promptSizeView({ success: true, tokens: 11997, chars: 47210, style: "medium", repoName: "CommitMG" }), {
      kind: "info",
      message: "Each request sends about 11,997 tokens (47,210 characters) with these settings, measured on the current changes in CommitMG for the Medium style.",
    });
  });

  it("explains why nothing was measured", () => {
    assert.deepEqual(promptSizeView({ success: false, message: "No changes to describe." }), { kind: "warning", message: "Prompt size not measured: No changes to describe." });
    assert.equal(promptSizeView({ success: true }).kind, "warning", "a success without numbers is not shown as a size");
  });
});

describe("promptSizeKey", () => {
  it("changes only when the options change", () => {
    assert.equal(promptSizeKey({ diffBudget: 1 }), promptSizeKey({ diffBudget: 1 }));
    assert.notEqual(promptSizeKey({ diffBudget: 1 }), promptSizeKey({ diffBudget: 2 }));
  });
});
