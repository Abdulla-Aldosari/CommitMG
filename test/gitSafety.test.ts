// Regression tests for running git without a shell. File names come from the
// repository, so they are untrusted: a shell would expand $(...) on POSIX and
// %VAR% on Windows inside double quotes. Every git call must pass file names
// as plain arguments so they reach git byte for byte.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { buildPromptForRepo } from "../src/generation";

const IS_WINDOWS = process.platform === "win32";

// POSIX shells run $(...) even inside double quotes; cmd.exe expands %VAR%.
// Both names are valid file names on their platform.
const HOSTILE_NAME = IS_WINDOWS ? "%COMSPEC%.txt" : "$(touch PWNED).txt";

describe("git calls never go through a shell", () => {
  let repoRoot: string;

  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-gitsafety-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(repoRoot, HOSTILE_NAME), "original line\n", "utf8");
    git("add", ".");
    git("commit", "-q", "-m", "chore: initial commit");
    fs.writeFileSync(path.join(repoRoot, HOSTILE_NAME), "changed line\n", "utf8");
    git("add", ".");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("passes a hostile file name to git literally and runs no injected command", () => {
    const { userPrompt } = buildPromptForRepo(repoRoot, "titleOnly");

    assert.equal(fs.existsSync(path.join(repoRoot, "PWNED")), false, "a shell expanded the file name and ran an injected command");
    assert.ok(userPrompt.includes(`<commitmg_old_file path="${HOSTILE_NAME}" changed_lines="1-1">`), "old-file evidence for the hostile file name is missing");
    assert.ok(userPrompt.includes("original line"), "the committed content of the hostile file was not read");
  });
});
