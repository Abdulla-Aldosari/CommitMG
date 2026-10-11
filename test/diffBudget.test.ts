// Tests for sharing the diff budget across files.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { shareBudget, splitDiffSections, truncateDiff } from "../src/generation/changes";

const fileDiff = (name: string, lines: number): string => {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i} of ${name}`).join("\n");
  return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${lines} @@\n${body}\n`;
};

describe("splitDiffSections", () => {
  it("splits at every file header and the untracked block, losing nothing", () => {
    const diff = `${fileDiff("a.ts", 2)}${fileDiff("b.ts", 3)}\n=== UNTRACKED (NEW) FILES ===\n--- c.ts (new file) ---\nhello\n`;
    const sections = splitDiffSections(diff);
    assert.equal(sections.length, 3);
    assert.ok(sections[0].startsWith("diff --git a/a.ts"));
    assert.ok(sections[2].startsWith("=== UNTRACKED"));
    assert.equal(sections.join(""), diff);
  });

  it("keeps a diff without headers as one section", () => {
    assert.deepEqual(splitDiffSections("+a\n+b"), ["+a\n+b"]);
  });
});

describe("shareBudget", () => {
  it("keeps small sections whole and shares the rest among the large ones", () => {
    assert.deepEqual(shareBudget([100, 5000, 200, 9000], 3300), [100, 1500, 200, 1500]);
  });

  it("never gives more than a section needs or more than the budget", () => {
    const shares = shareBudget([10, 20, 30], 1000);
    assert.deepEqual(shares, [10, 20, 30]);
    assert.ok(shareBudget([400, 400, 400], 600).reduce((sum, share) => sum + share, 0) <= 600);
  });
});

describe("truncateDiff", () => {
  it("returns a diff within the budget unchanged", () => {
    const diff = fileDiff("a.ts", 3);
    assert.equal(truncateDiff(diff, 10000), diff);
  });

  it("cuts a single-section diff at a line boundary with a marker", () => {
    const diff = Array.from({ length: 50 }, (_, i) => `+line number ${i}`).join("\n");
    const result = truncateDiff(diff, 100);
    const [head, marker] = result.split("\n... ");
    assert.ok(head.length <= 100 && diff.startsWith(head));
    assert.equal(marker, `diff truncated (${diff.length - head.length} characters omitted)`);
  });

  it("keeps every file in the prompt when one file is huge", () => {
    const diff = `${fileDiff("small.ts", 3)}${fileDiff("huge.ts", 2000)}${fileDiff("tail.ts", 3)}`;
    const result = truncateDiff(diff, 4000);
    assert.ok(result.includes(fileDiff("small.ts", 3)), "the small file is kept whole");
    assert.ok(result.includes(fileDiff("tail.ts", 3)), "the file after the huge one is kept whole");
    assert.match(result, /\+line \d+ of huge\.ts\n\.\.\. diff truncated \(\d+ characters omitted\)\ndiff --git a\/tail\.ts/);
  });
});
