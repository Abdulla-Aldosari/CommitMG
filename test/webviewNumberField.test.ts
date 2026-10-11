// Tests for the number field input check.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { parseNumberInput, type NumberRules } from "../src/webview/numberField";

const tokens: NumberRules = { min: 256, max: 65536, integer: true, allowEmpty: true };

describe("parseNumberInput", () => {
  it("accepts a whole number in range, with digit separators", () => {
    assert.deepEqual(parseNumberInput("8192", tokens), { ok: true, value: 8192 });
    assert.deepEqual(parseNumberInput(" 16,384 ", tokens), { ok: true, value: 16384 });
    assert.deepEqual(parseNumberInput("32_768", tokens), { ok: true, value: 32768 });
  });

  it("treats an empty field as Auto only when allowed", () => {
    assert.deepEqual(parseNumberInput("  ", tokens), { ok: true, value: null });
    assert.deepEqual(parseNumberInput("", { ...tokens, allowEmpty: false }), { ok: false, error: "Enter a number." });
  });

  it("rejects values outside the range with the bounds in the message", () => {
    assert.deepEqual(parseNumberInput("100", tokens), { ok: false, error: "Enter a value from 256 to 65,536." });
    assert.deepEqual(parseNumberInput("70000", tokens), { ok: false, error: "Enter a value from 256 to 65,536." });
  });

  it("rejects fractions where a whole number is required", () => {
    assert.deepEqual(parseNumberInput("512.5", tokens), { ok: false, error: "Enter a whole number." });
    assert.deepEqual(parseNumberInput("0.5", { min: 0, max: 1, integer: false, allowEmpty: false }), { ok: true, value: 0.5 });
  });

  it("rejects text that Number() would accept but a user would not mean", () => {
    for (const raw of ["1e3", "0x200", "abc", "12px", "Infinity", "-", "."]) {
      assert.deepEqual(parseNumberInput(raw, tokens), { ok: false, error: "Enter a number." }, raw);
    }
  });
});
