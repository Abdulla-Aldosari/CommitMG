// Tests for the Basic convention: a plain summary header with no type and
// no scope, for projects that do not follow Conventional Commits.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import type { AiClient } from "../src/ai/aiClient";
import { buildPrompt, generateCommitMessage, validateBasicHeader } from "../src/generation";
import { assertExamplesValid, BASIC_HEADER_EXAMPLES, selectExample } from "../src/generation/prompt/examples";
import { DEFAULT_COMMIT_TYPES, DEFAULT_MESSAGE_FORMAT } from "../src/generation/types";

const STAT = " src/a.ts | 2 +-";
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-foo\n+bar";

describe("Basic header examples", () => {
  it("cover every limit the ladders cover", () => {
    for (let limit = 52; limit <= 102; limit++) {
      assert.doesNotThrow(() => assertExamplesValid({ header: limit, body: limit }));
      assert.ok(selectExample(BASIC_HEADER_EXAMPLES, limit, "good").length < limit, `good under ${limit}`);
      assert.ok(selectExample(BASIC_HEADER_EXAMPLES, limit, "bad").length > limit, `bad over ${limit}`);
    }
  });

  it("are plain summaries themselves", () => {
    for (const example of BASIC_HEADER_EXAMPLES) {
      assert.deepEqual(validateBasicHeader(example), [], example);
    }
  });
});

describe("validateBasicHeader", () => {
  it("accepts a plain summary", () => {
    assert.deepEqual(validateBasicHeader("Add login page\n\nWhy it was needed."), []);
  });

  it("rejects a Conventional prefix, a lowercase start, and a trailing period", () => {
    assert.match(validateBasicHeader("feat(auth): Add login")[0], /must not start with a type or scope prefix/);
    assert.equal(validateBasicHeader("Fix: crash on start").length, 1);
    assert.deepEqual(validateBasicHeader("add login page"), ["the summary must start with a capital letter"]);
    assert.deepEqual(validateBasicHeader("Add login page."), ["the summary must not end with a period"]);
  });

  it("rejects an empty first line or a code fence", () => {
    assert.match(validateBasicHeader("")[0], /must be a plain summary/);
    assert.match(validateBasicHeader("```\nAdd login\n```")[0], /must be a plain summary/);
  });
});

describe("buildPrompt Basic convention", () => {
  const { systemPrompt } = buildPrompt("medium", ["auth"], STAT, DIFF, { header: 72, body: 72 }, [], "", undefined, "compact", DEFAULT_COMMIT_TYPES, {
    ...DEFAULT_MESSAGE_FORMAT,
    convention: "basic",
  });

  it("asks for a plain summary with Basic examples", () => {
    assert.ok(systemPrompt.includes("no type, no scope, no prefix of any kind"));
    assert.ok(systemPrompt.includes(`GOOD example:\n  ${selectExample(BASIC_HEADER_EXAMPLES, 72, "good")}`));
    assert.ok(systemPrompt.includes("=== SUMMARY ===\n- Capital first letter"));
  });

  it("leaves out Conventional Commits, the types, and the scopes", () => {
    assert.ok(!systemPrompt.includes("Conventional Commits"));
    assert.ok(!systemPrompt.includes("=== TYPE ==="));
    assert.ok(!systemPrompt.includes("=== SCOPE ==="));
  });

  it("keeps the body rules", () => {
    assert.ok(systemPrompt.includes("=== BODY ==="));
    assert.ok(systemPrompt.includes("=== LINE WRAP RULE ==="));
  });
});

class CannedClient implements AiClient {
  readonly providerName = "custom" as const;
  readonly calls: string[] = [];

  constructor(private readonly responses: readonly string[]) {}

  async complete(systemPrompt: string): Promise<string> {
    this.calls.push(systemPrompt);
    return this.responses[this.calls.length - 1];
  }

  async checkConnection(): Promise<void> {}
}

describe("generateCommitMessage with the Basic convention", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-basic-"));
    execSync("git init -q", { cwd: repoRoot });
    execSync('git config user.email "test@example.com"', { cwd: repoRoot });
    execSync('git config user.name "Test"', { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "initial\n", "utf8");
    execSync("git add a.txt", { cwd: repoRoot });
    execSync('git commit -q -m "Start"', { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "changed\n", "utf8");
    execSync("git add a.txt", { cwd: repoRoot });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("accepts a plain summary, ignoring a required scope in the project rules, and adds no emoji", async () => {
    fs.writeFileSync(path.join(repoRoot, ".commitmgrc.json"), JSON.stringify({ scopePolicy: "required", scopes: [{ name: "a" }] }), "utf8");
    const client = new CannedClient(["Handle the changed input case"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client, undefined, { options: { convention: "basic", emojiPosition: "beforeType" } });

    assert.equal(message, "Handle the changed input case");
    assert.equal(client.calls.length, 1);
  });

  it("asks for a correction when the reply carries a type prefix", async () => {
    const client = new CannedClient(["fix: handle the changed input", "Handle the changed input"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client, undefined, { options: { convention: "basic" } });

    assert.equal(message, "Handle the changed input");
    assert.ok(client.calls[1].includes("must not start with a type or scope prefix"));
  });
});
