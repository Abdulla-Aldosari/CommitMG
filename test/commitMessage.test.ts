// Unit tests for the silent commit message generator (commitMessage.ts).
// Only the pure helpers are tested here; the AI provider calls and the git
// CLI paths are exercised manually through the extension button.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import type { AiClient } from "../src/ai/aiClient";
import {
  assertExamplesValid,
  buildEvidenceSections,
  buildPrompt,
  buildPromptForRepo,
  CommitlintLimits,
  CommitStyle,
  EvidenceFile,
  formatPromptPreview,
  generateCommitMessage,
  readAcceptedScopes,
  readCommitlintLimits,
  readScopeMap,
  resolveScopesForFiles,
  ScopeMapEntry,
  validateCommitMessage,
  validateHeaderMeta,
} from "../src/commitMessage";

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

    assert.ok(userPrompt.includes("<commitmg_summary>"));
    assert.ok(userPrompt.includes(STAT));
    assert.ok(userPrompt.includes("</commitmg_summary>"));
    assert.ok(userPrompt.includes("<commitmg_diff>"));
    assert.ok(userPrompt.includes(DIFF));
    assert.ok(userPrompt.includes("</commitmg_diff>"));
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

describe("readCommitlintLimits", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-limits-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the default limits when the project has no commitlint.config.js", () => {
    assert.deepEqual(readCommitlintLimits(tmpDir), { header: 55, body: 55 });
  });

  it("reads the limits from the header-max-length and body-max-line-length rules", () => {
    fs.writeFileSync(
      path.join(tmpDir, "commitlint.config.js"),
      'module.exports = { rules: { "header-max-length": [2, "always", 72], "body-max-line-length": [2, "always", 72] } };\n',
      "utf8",
    );

    assert.deepEqual(readCommitlintLimits(tmpDir), { header: 72, body: 72 });
  });

  it("falls back to the default for a missing rule", () => {
    fs.writeFileSync(path.join(tmpDir, "commitlint.config.js"), 'module.exports = { rules: { "header-max-length": [2, "always", 72] } };\n', "utf8");

    assert.deepEqual(readCommitlintLimits(tmpDir), { header: 72, body: 55 });
  });
});

describe("buildPrompt rules", () => {
  it("states the project limit and picks examples at limit - 2 and limit + 2", () => {
    const limits: CommitlintLimits = { header: 60, body: 60 };
    const { systemPrompt } = buildPrompt("medium", null, STAT, DIFF, limits);

    assert.ok(systemPrompt.includes("the project limit is 60 characters"));
    assert.ok(systemPrompt.includes("perf(query): drop redundant joins in repeated metric loads"));
    assert.ok(systemPrompt.includes("feat(edit-command): classify raw command output by stream type"));
  });

  it("places OUTPUT as the final section after the body rules", () => {
    const { systemPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(systemPrompt.lastIndexOf("=== OUTPUT ===") > systemPrompt.indexOf("=== BODY ==="));
    assert.ok(systemPrompt.trim().endsWith("No markdown fences, no explanations, no alternatives, no prefixes."));
  });

  it("filters negative scopes and explains them", () => {
    const { systemPrompt } = buildPrompt("medium", ["extension", "-extension", "test"], STAT, DIFF);

    assert.ok(systemPrompt.includes("Accepted scopes:\nextension, test"));
    assert.ok(!systemPrompt.includes("-extension"));
    assert.ok(systemPrompt.includes("internal-only"));
  });

  it("teaches wrapping with labeled GOOD and WRONG examples", () => {
    const { systemPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(systemPrompt.includes("GOOD example (short bullet fits on one line)"));
    assert.ok(systemPrompt.includes("GOOD example (long bullet wrapped at a word boundary)"));
    assert.ok(systemPrompt.includes("WRONG example (line exceeds the limit)"));
    assert.ok(systemPrompt.includes("WRONG example (no blank line between the two bullets)"));
    assert.ok(systemPrompt.includes("WRONG example (continuation missing the 2-space indent)"));
    assert.ok(systemPrompt.includes("WRONG example (break inside a word)"));
  });
});

describe("validateCommitMessage with custom limits", () => {
  it("validates against the provided limits", () => {
    const header60 = `fix(auth): ${"x".repeat(49)}`;

    assert.deepEqual(validateCommitMessage(`${header60}\n`, "titleOnly", { header: 60, body: 60 }), []);
    assert.equal(validateCommitMessage(`${header60}\n`, "titleOnly").length, 1);
  });
});

describe("readScopeMap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-scopemap-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when the project has no commitlint.config.js", () => {
    assert.equal(readScopeMap(tmpDir), null);
  });

  it("reads the exported baseScopes triples", () => {
    fs.writeFileSync(
      path.join(tmpDir, "commitlint.config.js"),
      [
        'const baseScopes = [["webview", "the Release tool webview UI", ["media/release.js", "media/release.css"]], ["tooltip", "data-tooltip system", ["media/tooltip.js"]]];',
        "module.exports = { baseScopes, rules: {} };",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(readScopeMap(tmpDir), [
      { scope: "webview", description: "the Release tool webview UI", files: ["media/release.js", "media/release.css"] },
      { scope: "tooltip", description: "data-tooltip system", files: ["media/tooltip.js"] },
    ]);
  });

  it("falls back to parsing commented scope lines", () => {
    fs.writeFileSync(
      path.join(tmpDir, "commitlint.config.js"),
      [
        "const baseScopes = [",
        '  "webview", // media/release.js + media/release.css: the Release tool webview UI',
        '  "ui", // general visual/UX change not confined to a single file',
        "];",
        "module.exports = { rules: {} };",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(readScopeMap(tmpDir), [
      { scope: "webview", description: "the Release tool webview UI", files: ["media/release.js", "media/release.css"] },
      { scope: "ui", description: "general visual/UX change not confined to a single file", files: [] },
    ]);
  });
});

describe("resolveScopesForFiles", () => {
  const scopeMap: ScopeMapEntry[] = [
    { scope: "release", description: "the whole Release tool", files: ["src/tools/release/"] },
    { scope: "engine", description: "release state machine", files: ["src/tools/release/engine.ts"] },
    { scope: "webview", description: "the Release tool webview UI", files: ["media/release.js", "media/release.css"] },
  ];

  it("prefers the exact file match over a directory prefix", () => {
    assert.deepEqual(resolveScopesForFiles(scopeMap, ["src/tools/release/engine.ts"]), [scopeMap[1]]);
  });

  it("uses a directory prefix when no exact match exists", () => {
    assert.deepEqual(resolveScopesForFiles(scopeMap, ["src/tools/release/publish.ts"]), [scopeMap[0]]);
  });

  it("returns all candidates when several scopes claim one file", () => {
    const map: ScopeMapEntry[] = [
      { scope: "deps", description: "dependencies", files: ["package.json"] },
      { scope: "package", description: "package metadata", files: ["package.json"] },
    ];

    assert.deepEqual(resolveScopesForFiles(map, ["package.json"]), map);
  });

  it("returns an empty array when nothing maps", () => {
    assert.deepEqual(resolveScopesForFiles(scopeMap, ["README.md"]), []);
  });
});

describe("validateHeaderMeta", () => {
  const acceptedScopes = ["webview", "tooltip"];
  const resolved: ScopeMapEntry[] = [{ scope: "webview", description: "the Release tool webview UI", files: ["media/release.css"] }];

  it("accepts a correct type and resolved scope", () => {
    assert.deepEqual(validateHeaderMeta("fix(webview): restore swallowed tooltip styles\n\nbody", acceptedScopes, resolved), []);
  });

  it("rejects an unknown type", () => {
    const problems = validateHeaderMeta("patch(webview): subject", acceptedScopes, resolved);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /^type "patch" is not allowed/);
  });

  it("rejects a scope outside the accepted list", () => {
    const problems = validateHeaderMeta("fix(bogus): subject", acceptedScopes, resolved);

    assert.equal(problems.length, 2);
    assert.match(problems[0], /^scope "bogus" is not in the accepted scope list/);
  });

  it("rejects a scope that does not match the resolved mapping", () => {
    const problems = validateHeaderMeta("fix(tooltip): subject", acceptedScopes, resolved);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /^scope should be "webview"/);
  });

  it("ignores headers that are not conventional-commits shaped", () => {
    assert.deepEqual(validateHeaderMeta("Not a header", acceptedScopes, resolved), []);
  });
});

describe("buildPrompt resolved scopes", () => {
  it("replaces the guess-work guidance with the resolved scope", () => {
    const resolved: ScopeMapEntry[] = [{ scope: "webview", description: "the Release tool webview UI", files: ["media/release.css"] }];
    const { systemPrompt } = buildPrompt("medium", ["webview", "tooltip"], STAT, DIFF, undefined, resolved);

    assert.ok(systemPrompt.includes("The changed files map to exactly one scope"));
    assert.ok(systemPrompt.includes("webview (the Release tool webview UI)"));
    assert.ok(!systemPrompt.includes("media/modals/edit-command.js"));
  });
});

describe("buildPrompt TYPE guide", () => {
  it("structures the type section with an accepted list and full explanations", () => {
    const { systemPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(systemPrompt.includes("Accepted <type>:"));
    assert.ok(systemPrompt.includes("feat, fix, perf, style, refactor, docs, test, chore, build, ci, revert"));
    assert.ok(systemPrompt.includes("How to Determine the Right Type:"));
    assert.ok(systemPrompt.includes("- feat:\n"));
    assert.ok(systemPrompt.includes("- fix:\n"));
    assert.ok(systemPrompt.includes("- revert:\n"));
    assert.ok(!systemPrompt.includes("Choose exactly one"));
  });
});

describe("buildEvidenceSections", () => {
  it("includes the whole old content when it fits the budget", () => {
    const entries: EvidenceFile[] = [{ file: "a.css", oldContent: "line1\nline2", firstChangedLine: 1, lastChangedLine: 1 }];
    const sections = buildEvidenceSections(entries, 1000, 100, 300);

    assert.equal(sections.length, 1);
    assert.equal(sections[0].file, "a.css");
    assert.ok(sections[0].content.includes('<commitmg_old_file path="a.css" changed_lines="1-1">'));
    assert.ok(sections[0].content.includes("</commitmg_old_file>"));
    assert.ok(sections[0].content.includes("line1\nline2"));
  });

  it("sorts ascending so the smallest files win the budget first", () => {
    const entries: EvidenceFile[] = [
      { file: "big.txt", oldContent: "x".repeat(900), firstChangedLine: 1, lastChangedLine: 1 },
      { file: "small.txt", oldContent: "y".repeat(100), firstChangedLine: 1, lastChangedLine: 1 },
    ];
    const sections = buildEvidenceSections(entries, 500, 400, 300);

    assert.deepEqual(
      sections.map((section) => section.file),
      ["small.txt"],
    );
  });

  it("gives an oversized file a window around its changed lines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}`);
    const entries: EvidenceFile[] = [{ file: "big.css", oldContent: lines.join("\n"), firstChangedLine: 100, lastChangedLine: 100 }];
    const sections = buildEvidenceSections(entries, 800, 100, 300);

    assert.equal(sections.length, 1);
    const content = sections[0].content;
    assert.ok(content.includes("line-99"));
    assert.ok(content.includes("line-100"));
    assert.ok(!content.includes("line-0"));
  });

  it("sends nothing when the remaining budget is below the partial minimum", () => {
    const entries: EvidenceFile[] = [{ file: "a.txt", oldContent: "x".repeat(5000), firstChangedLine: 1, lastChangedLine: 1 }];

    assert.deepEqual(buildEvidenceSections(entries, 500, 600, 300), []);
  });

  it("omits the changed_lines attribute when the range is unknown", () => {
    const entries: EvidenceFile[] = [{ file: "a.css", oldContent: "line1", firstChangedLine: 0, lastChangedLine: 0 }];
    const sections = buildEvidenceSections(entries, 1000, 100, 300);

    assert.ok(sections[0].content.includes('<commitmg_old_file path="a.css">'));
    assert.ok(!sections[0].content.includes("changed_lines"));
  });
});

describe("buildPrompt diff truncation", () => {
  it("caps an oversized diff and marks the truncation", () => {
    const hugeDiff = `diff --git a/x b/x\n+${"x".repeat(41000)}`;
    const { userPrompt } = buildPrompt("medium", null, STAT, hugeDiff);

    assert.ok(userPrompt.includes("... diff truncated"));
    assert.ok(userPrompt.length < STAT.length + hugeDiff.length);
  });

  it("appends old-file evidence after the diff", () => {
    const evidence = '\n<commitmg_old_file path="a.css">\nold-line\n</commitmg_old_file>';
    const { userPrompt } = buildPrompt("medium", null, STAT, DIFF, undefined, [], evidence);

    assert.ok(userPrompt.includes('<commitmg_old_file path="a.css">\nold-line\n</commitmg_old_file>'));
    assert.ok(userPrompt.endsWith("</commitmg_diff>"));
  });

  it("explains the changed_lines attribute in the introduction", () => {
    const { userPrompt } = buildPrompt("medium", null, STAT, DIFF);

    assert.ok(userPrompt.includes("the changed_lines attribute lists the 1-based line"));
    assert.ok(userPrompt.includes("inspect those lines inside the old content"));
  });
});

// A minimal AiClient stub that returns fixed responses in order, recording
// every (systemPrompt, userPrompt) pair it was called with so the retry
// behavior of generateCommitMessage() can be asserted without any network
// access or real provider.
class FakeAiClient implements AiClient {
  calls: Array<{ systemPrompt: string; userPrompt: string }> = [];

  constructor(private readonly responses: readonly string[]) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    this.calls.push({ systemPrompt, userPrompt });
    const response = this.responses[this.calls.length - 1];
    if (response === undefined) {
      throw new Error("FakeAiClient ran out of canned responses");
    }
    return response;
  }

  async checkConnection(): Promise<void> {}
}

describe("generateCommitMessage", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-gen-test-"));
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

  it("returns the AI client's response when it already passes validation", async () => {
    const client = new FakeAiClient(["fix(a): handle changed input case"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client);

    assert.equal(message, "fix(a): handle changed input case");
    assert.equal(client.calls.length, 1);
  });

  it("retries once with a correction prompt when the first response violates the rules", async () => {
    const client = new FakeAiClient(["bad header that is definitely far too long to pass the limit check", "fix(a): shorten the header"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client);

    assert.equal(message, "fix(a): shorten the header");
    assert.equal(client.calls.length, 2);
    assert.ok(client.calls[1].systemPrompt.includes("=== CORRECTION REQUIRED ==="));
    assert.ok(client.calls[1].systemPrompt.includes("bad header that is definitely far too long to pass the limit check"));
  });

  it("invokes the observer with the first-attempt and correction violations", async () => {
    const client = new FakeAiClient(["bad header that is definitely far too long to pass the limit check", "fix(a): shorten the header"]);
    const firstAttemptViolations: string[][] = [];
    const correctionViolations: string[][] = [];

    await generateCommitMessage(repoRoot, "titleOnly", client, {
      onFirstAttempt: (violations) => firstAttemptViolations.push([...violations]),
      onCorrection: (violations) => correctionViolations.push([...violations]),
    });

    assert.equal(firstAttemptViolations.length, 1);
    assert.ok(firstAttemptViolations[0].length > 0);
    assert.equal(correctionViolations.length, 1);
    assert.deepEqual(correctionViolations[0], []);
  });

  it("sends exactly the prebuilt prompts when provided instead of rebuilding them", async () => {
    const client = new FakeAiClient(["fix(a): handle changed input case"]);
    const prebuiltPrompts = { systemPrompt: "SYS-PREBUILT", userPrompt: "USER-PREBUILT" };

    await generateCommitMessage(repoRoot, "titleOnly", client, undefined, prebuiltPrompts);

    assert.equal(client.calls[0].systemPrompt, "SYS-PREBUILT");
    assert.equal(client.calls[0].userPrompt, "USER-PREBUILT");
  });
});
