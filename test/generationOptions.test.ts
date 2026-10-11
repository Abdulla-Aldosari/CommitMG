// Tests for the prompt size knobs: how raw values are normalized, and that
// each knob reaches the prompt built from a real repository.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { buildPromptForRepo, DEFAULT_GENERATION_OPTIONS, GENERATION_OPTION_RANGES, normalizeOptions } from "../src/generation";

describe("normalizeOptions", () => {
  it("returns the engine defaults for missing values", () => {
    assert.deepEqual(normalizeOptions(), DEFAULT_GENERATION_OPTIONS);
    assert.deepEqual(normalizeOptions({ diffBudget: 12000 }), { ...DEFAULT_GENERATION_OPTIONS, diffBudget: 12000 });
  });

  it("clamps numbers into their range and rounds them", () => {
    const { min, max } = GENERATION_OPTION_RANGES.diffBudget;
    assert.equal(normalizeOptions({ diffBudget: 1 }).diffBudget, min);
    assert.equal(normalizeOptions({ diffBudget: 10_000_000 }).diffBudget, max);
    assert.equal(normalizeOptions({ untrackedMaxFiles: 7.6 }).untrackedMaxFiles, 8);
  });

  it("ignores malformed values from a hand-edited settings file", () => {
    const raw = { includeEvidence: "no", evidenceBudget: "big", diffBudget: Number.NaN, untrackedMaxBytes: null } as unknown as Parameters<typeof normalizeOptions>[0];
    assert.deepEqual(normalizeOptions(raw), DEFAULT_GENERATION_OPTIONS);
  });
});

describe("generation options reach the prompt", () => {
  let repoRoot: string;
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-options-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "export const answer = 41;\n", "utf8");
    git("add", ".");
    git("commit", "-q", "-m", "chore: initial commit");
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "export const answer = 42;\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("sends old-file evidence by default and none when it is turned off", async () => {
    assert.ok((await buildPromptForRepo(repoRoot, "titleOnly")).userPrompt.includes('<commitmg_old_file path="app.ts"'));
    assert.ok(!(await buildPromptForRepo(repoRoot, "titleOnly", { includeEvidence: false })).userPrompt.includes("<commitmg_old_file"));
  });

  it("shows the chosen number of context lines around a change", async () => {
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "// one\n// two\n// three\nexport const answer = 41;\n// four\n// five\n// six\n", "utf8");
    git("commit", "-q", "-am", "chore: add context");
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "// one\n// two\n// three\nexport const answer = 42;\n// four\n// five\n// six\n", "utf8");

    const none = (await buildPromptForRepo(repoRoot, "titleOnly", { diffContextLines: 0, includeEvidence: false })).userPrompt;
    assert.ok(none.includes("@@ -4 +4 @@") && !none.includes(" // three"));
    const three = (await buildPromptForRepo(repoRoot, "titleOnly", { includeEvidence: false })).userPrompt;
    assert.ok(three.includes(" // three") && three.includes(" // four"));
    assert.ok(!three.slice(0, three.indexOf("<commitmg_diff>")).includes("@@"), "the summary never carries the patch");
  });

  it("leaves whitespace-only changes out, but never sends an empty diff", async () => {
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "export const answer = 42;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "style.ts"), "x\n", "utf8");
    git("add", ".");
    git("commit", "-q", "-m", "chore: base");
    fs.writeFileSync(path.join(repoRoot, "app.ts"), "export const answer = 43;\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "style.ts"), "    x\n", "utf8");

    const mixed = (await buildPromptForRepo(repoRoot, "titleOnly", { ignoreWhitespace: true, includeEvidence: false })).userPrompt;
    assert.ok(mixed.includes("answer = 43") && !mixed.includes("diff --git a/style.ts"));

    git("checkout", "--", "app.ts");
    const onlyWhitespace = (await buildPromptForRepo(repoRoot, "titleOnly", { ignoreWhitespace: true, includeEvidence: false })).userPrompt;
    assert.ok(onlyWhitespace.includes("diff --git a/style.ts"), "a whitespace-only change falls back to the full diff");
  });

  it("applies the diff budget and the untracked-file caps", async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(repoRoot, `new${i}.ts`), `${"x".repeat(3000)}\n`, "utf8");
    }
    const small = await buildPromptForRepo(repoRoot, "titleOnly", { diffBudget: 4000, untrackedMaxFiles: 2 });
    assert.match(small.userPrompt, /diff truncated \(\d+ characters omitted\)/);
    assert.match(small.userPrompt, /Untracked files \(5\):\n new0\.ts\n new1\.ts\n \.\.\./);
  });
});
