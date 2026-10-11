// Tests for the step slider value math.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { clampIndex, fractionFor, indexAfterKey, indexAtFraction, initialIndex } from "../src/webview/stepSlider";

describe("step slider math", () => {
  it("starts on the given value, or on the first one when it is unknown", () => {
    const values = ["Auto", "Off", "Low", "High"];
    assert.equal(initialIndex(values, "Low"), 2);
    assert.equal(initialIndex(values, "Max"), 0);
    assert.equal(initialIndex(values, undefined), 0);
  });

  it("clamps and rounds an index into the value range", () => {
    assert.equal(clampIndex(-3, 4), 0);
    assert.equal(clampIndex(9, 4), 3);
    assert.equal(clampIndex(1.6, 4), 2);
    assert.equal(clampIndex(5, 0), 0);
  });

  it("places values evenly along the bar", () => {
    assert.deepEqual(
      [0, 1, 2, 3].map((index) => fractionFor(index, 4)),
      [0, 1 / 3, 2 / 3, 1],
    );
    assert.equal(fractionFor(0, 1), 0);
  });

  it("snaps a pointer position to the nearest value", () => {
    assert.equal(indexAtFraction(0.1, 4), 0);
    assert.equal(indexAtFraction(0.2, 4), 1);
    assert.equal(indexAtFraction(0.9, 4), 3);
    assert.equal(indexAtFraction(-0.5, 4), 0);
    assert.equal(indexAtFraction(1.7, 4), 3);
    assert.equal(indexAtFraction(Number.NaN, 4), 0);
  });

  it("moves one step per arrow key and jumps to the ends with Home and End", () => {
    assert.equal(indexAfterKey("ArrowRight", 1, 4), 2);
    assert.equal(indexAfterKey("ArrowUp", 3, 4), 3);
    assert.equal(indexAfterKey("ArrowLeft", 0, 4), 0);
    assert.equal(indexAfterKey("PageDown", 2, 4), 1);
    assert.equal(indexAfterKey("Home", 2, 4), 0);
    assert.equal(indexAfterKey("End", 0, 4), 3);
    assert.equal(indexAfterKey("Enter", 1, 4), null);
  });
});
