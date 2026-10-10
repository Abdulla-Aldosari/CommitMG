// The single place that runs git for the generation engine. Commands are
// executed with execFileSync and an argument array, never through a shell:
// file names come from the repository and are untrusted, and a shell would
// expand $(...) on POSIX or %VAR% on Windows even inside double quotes.
// Every git call in the engine must go through runGit().

import { execFileSync } from "child_process";

// Runs `git <args>` in repoRoot and returns stdout as UTF-8 text. Throws on a
// non-zero exit code, exactly like the previous execSync-based calls.
export function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
