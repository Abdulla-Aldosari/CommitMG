// Unit tests for the silent commit message generator (commitMessage.ts).
// Only the pure helpers are tested here; the AI provider calls and the git
// CLI paths are exercised manually through the extension button.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { assertExamplesValid, buildPrompt, buildPromptForRepo, CommitStyle, formatPromptPreview, readAcceptedScopes, validateCommitMessage } from "../src/commitMessage";

const HEADER_MAX_LENGTH = 55;
const BODY_MAX_LENGTH = 55;

const STAT = " src/a.ts | 10 +++++-----";
const DIFF = "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-foo\n+bar";

describe("validateCommitMessage", () => {
  it("accepts a valid medium message", () => {
    const message = ["fix(auth): handle expired tokens", "", "- Why: tokens expire faster than refresh.", "", "- Reissue a token when a 401 arrives mid-flight."].join("\n");

    assert.deepEqual(validateCommitMessage(message, "medium"), []);
  });

  it("reports a header that exceeds the length limit", () => {
    const header = `fix(${"x".repeat(HEADER_MAX_LENGTH + 10)}): subject`;

    const problems = validateCommitMessage(`${header}\n`, "medium");

    assert.equal(problems.length, 1);
    assert.match(problems[0], /^header is \d+ chars \(max 55\)$/);
  });

  it("reports a body line that exceeds the length limit", () => {
    const bullet = `- ${"x".repeat(BODY_MAX_LENGTH + 5)}`;

    const problems = validateCommitMessage(`fix(auth): subject\n\n${bullet}\n`, "medium");

    assert.equal(problems.length, 1);
    assert.match(problems[0], /^body line 3 is \d+ chars \(max 55\)$/);
  });

  it("reports a bullet that is not preceded by a blank line", () => {
    const problems = validateCommitMessage("fix(auth): subject\n\n- first bullet\n- second bullet", "medium");

    assert.equal(problems.length, 1);
    assert.match(problems[0], /^bullet on line 4 is not preceded by a blank line$/);
  });

  it("caps medium style at four bullets", () => {
    const bullets = ["- a", "- b", "- c", "- d", "- e"].join("\n\n");

    assert.deepEqual(validateCommitMessage(`fix(auth): subject\n\n${bullets}\n`, "medium"), ["medium style allows at most 4 bullets, found 5"]);
  });

  it("does not cap lengthy style bullets", () => {
    const bullets = ["- a", "- b", "- c", "- d", "- e"].join("\n\n");

    assert.deepEqual(validateCommitMessage(`fix(auth): subject\n\n${bullets}\n`, "lengthy"), []);
  });
});

describe("buildPrompt", () => {
  it("embeds the change summary and diff in the user prompt", () => {
    const { userPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(userPrompt.includes("=== CHANGES SUMMARY ==="));
    assert.ok(userPrompt.includes(STAT));
    assert.ok(userPrompt.includes("=== CHANGES DIFF ==="));
    assert.ok(userPrompt.includes(DIFF));
  });

  it("injects the accepted scopes from commitlint", () => {
    const { systemPrompt } = buildPrompt("medium", ["extension", "test"], STAT, DIFF);

    assert.ok(systemPrompt.includes("Use the exact name from the accepted list"));
    assert.ok(systemPrompt.includes("extension, test"));
  });

  it("marks the scope as unrestricted without a scope-enum rule", () => {
    const { systemPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(systemPrompt.includes("Accepted scopes: unrestricted."));
  });

  it("includes a body section for medium but omits it for titleOnly", () => {
    const medium = buildPrompt("medium", null, STAT, DIFF).systemPrompt;
    assert.ok(medium.includes("=== BODY ==="));
    assert.ok(medium.includes("2 to 4 bullet points"));

    const titleOnly = buildPrompt("titleOnly", null, STAT, DIFF).systemPrompt;
    assert.ok(titleOnly.includes("OMIT ENTIRELY"));
  });
});

describe("assertExamplesValid", () => {
  it("does not throw with the current limits", () => {
    assert.doesNotThrow(() => assertExamplesValid());
  });
});

describe("readAcceptedScopes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when the project has no commitlint.config.js", () => {
    assert.equal(readAcceptedScopes(tmpDir), null);
  });

  it("reads the scope list from the scope-enum rule", () => {
    fs.writeFileSync(path.join(tmpDir, "commitlint.config.js"), 'module.exports = { rules: { "scope-enum": [2, "always", ["extension", "test"]] } };\n', "utf8");

    assert.deepEqual(readAcceptedScopes(tmpDir), ["extension", "test"]);
  });

  it("throws when scope-enum is missing", () => {
    fs.writeFileSync(path.join(tmpDir, "commitlint.config.js"), "module.exports = { rules: {} };\n", "utf8");

    assert.throws(() => readAcceptedScopes(tmpDir), /"scope-enum" in commitlint\.config\.js is missing or malformed/);
  });

  it("throws when scope-enum is malformed", () => {
    fs.writeFileSync(path.join(tmpDir, "commitlint.config.js"), 'module.exports = { rules: { "scope-enum": [2, "always", "not-an-array"] } };\n', "utf8");

    assert.throws(() => readAcceptedScopes(tmpDir), /"scope-enum" in commitlint\.config\.js is missing or malformed/);
  });
});

describe("formatPromptPreview", () => {
  it("renders the style and both prompts under headings", () => {
    const preview = formatPromptPreview("medium", "SYS-TEXT", "USER-TEXT");

    assert.ok(preview.includes("# Commit MG — Prompt Preview"));
    assert.ok(preview.includes("Style: medium"));
    assert.ok(preview.includes("System prompt: 8 characters"));
    assert.ok(preview.includes("## System Prompt"));
    assert.ok(preview.includes("SYS-TEXT"));
    assert.ok(preview.includes("## User Prompt"));
    assert.ok(preview.includes("User prompt: 9 characters"));
    assert.ok(preview.includes("USER-TEXT"));
  });
});

describe("buildPromptForRepo", () => {
  it("rejects an unknown style before touching git", () => {
    assert.throws(() => buildPromptForRepo(os.tmpdir(), "bogus" as CommitStyle), /Unknown style: bogus\. Valid values are: lengthy, medium, short, titleOnly\./);
  });
});
