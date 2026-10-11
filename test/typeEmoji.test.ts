// Tests for the type emoji: the fixed emoji per type, where it is added,
// the header space kept free for it, and a full run that adds it.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import type { AiClient } from "../src/ai/aiClient";
import { generateCommitMessage } from "../src/generation";
import { applyTypeEmoji, emojiReserve, TYPE_EMOJIS } from "../src/generation/format/typeEmoji";
import { DEFAULT_COMMIT_TYPES } from "../src/generation/types";

describe("TYPE_EMOJIS", () => {
  it("gives every default type its own emoji", () => {
    for (const type of DEFAULT_COMMIT_TYPES) {
      assert.ok(TYPE_EMOJIS[type], `${type} has no emoji`);
    }
    const emojis = DEFAULT_COMMIT_TYPES.map((type) => TYPE_EMOJIS[type]);
    assert.equal(new Set(emojis).size, emojis.length);
  });
});

describe("applyTypeEmoji", () => {
  it("adds the emoji before the type, scope or not", () => {
    assert.equal(applyTypeEmoji("feat: add new feature", "beforeType"), "\u2728 feat: add new feature");
    assert.equal(applyTypeEmoji("fix(webview): resolve ui bug", "beforeType"), "\u{1F41B} fix(webview): resolve ui bug");
  });

  it("adds the emoji before the subject, keeping the scope and the breaking mark", () => {
    assert.equal(applyTypeEmoji("fix(webview): resolve ui bug", "beforeSubject"), "fix(webview): \u{1F41B} resolve ui bug");
    assert.equal(applyTypeEmoji("docs: update readme", "beforeSubject"), "docs: \u{1F4DD} update readme");
    assert.equal(applyTypeEmoji("feat(api)!: drop v1", "beforeSubject"), "feat(api)!: \u2728 drop v1");
  });

  it("leaves the body untouched", () => {
    assert.equal(applyTypeEmoji("fix: a\n\n- why it broke", "beforeSubject"), "fix: \u{1F41B} a\n\n- why it broke");
  });

  it("returns the message as it is when there is nothing to add", () => {
    assert.equal(applyTypeEmoji("feat: add", "off"), "feat: add");
    assert.equal(applyTypeEmoji("i18n: translate the panel", "beforeType"), "i18n: translate the panel");
    assert.equal(applyTypeEmoji("Not a header", "beforeType"), "Not a header");
    assert.equal(applyTypeEmoji("feat: \u2728 add", "beforeSubject"), "feat: \u2728 add");
  });
});

describe("emojiReserve", () => {
  it("keeps room for the longest emoji of the allowed types plus a space", () => {
    assert.equal(emojiReserve(DEFAULT_COMMIT_TYPES, "beforeType"), 4);
    assert.equal(emojiReserve(["feat", "test"], "beforeSubject"), 2);
    assert.equal(emojiReserve(["fix"], "beforeSubject"), 3);
  });

  it("keeps no room when emojis are off or no type has one", () => {
    assert.equal(emojiReserve(DEFAULT_COMMIT_TYPES, "off"), 0);
    assert.equal(emojiReserve(["i18n"], "beforeType"), 0);
  });

  it("counts length the way commitlint does, in UTF-16 code units", () => {
    assert.equal(`${TYPE_EMOJIS.build} build: x`.length, 12);
  });
});

class CannedClient implements AiClient {
  readonly providerName = "custom" as const;
  readonly calls: Array<{ systemPrompt: string }> = [];

  constructor(private readonly responses: readonly string[]) {}

  async complete(systemPrompt: string): Promise<string> {
    this.calls.push({ systemPrompt });
    return this.responses[this.calls.length - 1];
  }

  async checkConnection(): Promise<void> {}
}

describe("generateCommitMessage with a type emoji", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-emoji-"));
    execSync("git init -q", { cwd: repoRoot });
    execSync('git config user.email "test@example.com"', { cwd: repoRoot });
    execSync('git config user.name "Test"', { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "initial\n", "utf8");
    execSync("git add a.txt", { cwd: repoRoot });
    execSync('git commit -q -m "chore: initial commit"', { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "changed\n", "utf8");
    execSync("git add a.txt", { cwd: repoRoot });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("adds the emoji to the model's message and asks the model for a shorter header", async () => {
    const client = new CannedClient(["fix(a): handle changed input case"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client, undefined, { options: { emojiPosition: "beforeSubject" } });

    assert.equal(message, "fix(a): \u{1F41B} handle changed input case");
    assert.ok(client.calls[0].systemPrompt.includes("the project limit is 51 characters"));
  });

  it("shows the model its own text, without the emoji, when it asks for a correction", async () => {
    const tooLong = "fix(a): a header that is far too long for the shortened model limit";
    const client = new CannedClient([tooLong, "fix(a): shorten it"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client, undefined, { options: { emojiPosition: "beforeType" } });

    assert.equal(message, "\u{1F41B} fix(a): shorten it");
    assert.ok(client.calls[1].systemPrompt.includes(`Your previous output was:\n\n${tooLong}\n`));
    assert.ok(client.calls[1].systemPrompt.includes("(max 51)"));
  });
});
