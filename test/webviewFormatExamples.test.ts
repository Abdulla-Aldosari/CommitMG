// Tests for the View Examples window of the Message Format tab: every
// sample is a valid message in the chosen form.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { validateBasicHeader, validateCommitMessage, validateHeaderMeta } from "../src/generation";
import { TYPE_EMOJIS } from "../src/generation/format/typeEmoji";
import { DEFAULT_COMMIT_TYPES } from "../src/generation/types";
import { formatExamples, formatExampleHtml, type FormatExampleInput } from "../src/webview/formatExamples";

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

  describe("formatExampleHtml", () => {
    it("marks the conventional type, scope, and subject with distinct spans", () => {
      const example = formatExamples({ ...base, emojiPosition: "beforeType", limits: { header: 72, body: 72 } })[0];

      const html = formatExampleHtml(example);
      assert.ok(html.includes('<span class="fm-type">fix</span>'));
      assert.ok(html.includes('<span class="fm-scope">(auth)</span>'));
      assert.ok(html.includes('<span class="fm-subject">'));
    });

    it("keeps a Basic summary as one subject span and marks bullets in the body", () => {
      const example = formatExamples({ ...base, convention: "basic", limits: { header: 72, body: 72 } })[0];

      const html = formatExampleHtml(example);
      assert.ok(html.includes('<span class="fm-subject">Refresh the session token before it expires, not after a failed request</span>'));
      assert.ok(html.includes('<span class="fm-bullet">- refresh the token'));
    });

    it("renders title-only examples without a body", () => {
      const example = formatExamples(base)[3];

      assert.ok(!formatExampleHtml(example).includes("fm-body"));
    });

    it("escapes markup in the example text", () => {
      const example = { style: "short" as const, label: "Short <b>", message: "fix(auth): use <tag> & verify" };

      const html = formatExampleHtml(example);
      assert.ok(!html.includes("<b>") && !html.includes("<tag>"));
      assert.ok(html.includes("&lt;b&gt;") && html.includes("&lt;tag&gt;") && html.includes("&amp;"));
    });
  });
});
