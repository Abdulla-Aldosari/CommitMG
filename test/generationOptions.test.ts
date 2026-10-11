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

  it("applies the diff budget and the untracked-file caps", async () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(repoRoot, `new${i}.ts`), `${"x".repeat(3000)}\n`, "utf8");
    }
    const small = await buildPromptForRepo(repoRoot, "titleOnly", { diffBudget: 4000, untrackedMaxFiles: 2 });
    assert.match(small.userPrompt, /diff truncated \(\d+ characters omitted\)/);
    assert.match(small.userPrompt, /Untracked files \(5\):\n new0\.ts\n new1\.ts\n \.\.\./);
  });
});
