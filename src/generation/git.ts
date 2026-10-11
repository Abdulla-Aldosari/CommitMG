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

// Runs a git command that lists paths with -z and returns them verbatim.
// The NUL-separated form is the only one git never quotes: plain output
// escapes non-ASCII and special characters (core.quotePath), which breaks
// every later lookup that uses the path.
// -z goes before any "--" separator: everything after it is a pathspec.
export function runGitPathList(repoRoot: string, args: readonly string[]): string[] {
  const separator = args.indexOf("--");
  const withZ = separator < 0 ? [...args, "-z"] : [...args.slice(0, separator), "-z", ...args.slice(separator)];
  return runGit(repoRoot, withZ)
    .split("\0")
    .filter((entry) => entry.length > 0);
}
