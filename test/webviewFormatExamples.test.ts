// Tests for the View Examples window of the Message Format tab: every
// sample is a valid message in the chosen form.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { validateBasicHeader, validateCommitMessage, validateHeaderMeta } from "../src/generation";
import { TYPE_EMOJIS } from "../src/generation/format/typeEmoji";
import { DEFAULT_COMMIT_TYPES } from "../src/generation/types";
import { formatExamples, type FormatExampleInput } from "../src/webview/formatExamples";

const base: FormatExampleInput = { convention: "conventional", emojiPosition: "off", bulletSpacing: "blank", limits: { header: 72, body: 72 }, types: DEFAULT_COMMIT_TYPES };

describe("formatExamples", () => {
  it("gives one sample per detail level, in order", () => {
    assert.deepEqual(
      formatExamples(base).map((example) => example.label),
      ["Lengthy", "Medium", "Short", "Title only"],
    );
  });

  it("only shows messages that pass the checks, for every limit and spacing", () => {
    for (let limit = 52; limit <= 102; limit += 5) {
      for (const bulletSpacing of ["blank", "compact"] as const) {
        for (const example of formatExamples({ ...base, bulletSpacing, limits: { header: limit, body: limit } })) {
          assert.deepEqual(validateCommitMessage(example.message, example.style, { header: limit, body: limit }, bulletSpacing), [], `${limit} ${bulletSpacing} ${example.style}`);
          assert.deepEqual(validateHeaderMeta(example.message, null, []), [], example.message);
        }
      }
    }
  });

  it("adds the fix emoji where the setting puts it, still inside the header limit", () => {
    const [before] = formatExamples({ ...base, emojiPosition: "beforeType", limits: { header: 55, body: 55 } });
    const [after] = formatExamples({ ...base, emojiPosition: "beforeSubject", limits: { header: 55, body: 55 } });

    assert.ok(before.message.startsWith(`${TYPE_EMOJIS.fix} fix(auth): `));
    assert.ok(after.message.startsWith(`fix(auth): ${TYPE_EMOJIS.fix} `));
    for (const example of [before, after]) {
      assert.ok(example.message.split("\n")[0].length <= 55, example.message);
    }
  });

  it("shows a plain summary for the Basic convention", () => {
    for (const example of formatExamples({ ...base, convention: "basic", emojiPosition: "beforeType" })) {
      assert.deepEqual(validateBasicHeader(example.message), [], example.message);
    }
  });

  it("puts bullets on consecutive lines under compact spacing", () => {
    const medium = formatExamples({ ...base, bulletSpacing: "compact", limits: { header: 100, body: 100 } })[1];

    assert.ok(!medium.message.split("\n\n").slice(1).join("\n\n").includes("\n\n"));
  });
});
