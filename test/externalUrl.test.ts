// Tests for the external URL allow-list used by the settings panel.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { safeExternalUrl } from "../src/settings/externalUrl";

describe("safeExternalUrl", () => {
  it("accepts an https link", () => {
    assert.equal(safeExternalUrl("https://aistudio.google.com/api-keys"), "https://aistudio.google.com/api-keys");
  });

  for (const url of [
    "http://example.com/",
    "file:///C:/Windows/System32/calc.exe",
    "command:workbench.action.terminal.new",
    "vscode://settings/editor.fontSize",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "not a url",
    "",
  ]) {
    it(`rejects ${JSON.stringify(url)}`, () => {
      assert.equal(safeExternalUrl(url), null);
    });
  }

  it("rejects a value that is not a string", () => {
    assert.equal(safeExternalUrl(undefined), null);
    assert.equal(safeExternalUrl({ toString: () => "https://example.com" }), null);
  });
});
