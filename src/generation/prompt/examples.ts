// Exact-length GOOD/WRONG example ladders for the prompt, plus the
// self-check that guarantees every example matches its declared length.

import { DEFAULT_LIMITS, type CommitlintLimits } from "../types";
import { MIN_TYPE_EXPLANATION, TYPE_EXPLANATIONS } from "./typeGuide";

// The GOOD/WRONG examples come from hand-written ladders of exact-length
// strings (see the EXAMPLE GENERATORS section below), sized 50 to 86 characters
// in steps of 4. Every entry length is verified before each generation.
const EXAMPLE_LENGTHS: readonly number[] = [50, 54, 58, 62, 66, 70, 74, 78, 82, 86];

// ===================== EXAMPLE GENERATORS =====================
// The prompt's GOOD/WRONG examples come from hand-written ladders of
// exact-length strings: 10 complete headers and 10 complete body bullets,
// sized 50 to 86 characters in steps of 4 (EXAMPLE_LENGTHS). A selection
// function picks the GOOD example just UNDER the project limit (limit - 2)
// and the WRONG example just OVER it (limit + 2), so the examples teach
// the boundary without asking the model to count characters. Every entry
// length is verified by assertExamplesValid() before every generation, so
// an edited example that drifts from its declared length fails loudly
// instead of silently teaching a wrong length.

// Ladder of complete Conventional Commit headers, one per EXAMPLE_LENGTHS
// entry, in the same order. Each subject follows the SUBJECT rules below.
export const HEADER_EXAMPLES: readonly string[] = [
  "fix(auth): refresh expired tokens quietly at login",
  "feat(api): paginate query results without losing order",
  "perf(query): drop redundant joins in repeated metric loads",
  "feat(edit-command): classify raw command output by stream type",
  "chore(deps): upgrade parser libraries to the latest stable release",
  "fix(webview): close panels first before switching the active workspace",
  "feat(settings): remember panel collapse states across every editor session",
  "docs(readme): explain setup steps and the required environment variables fully",
  "fix(webview): close all opened panels before switching the active workspace screen",
  "chore(deps): upgrade core parser packages towards the very latest stable release train",
];

// Ladder of complete single-line body bullets, same lengths and order.
export const BODY_EXAMPLES: readonly string[] = [
  "- group duplicate imports under the same namespace",
  "- reorder the panels so the output stays visible above",
  "- keep the dialog open after a failed submit attempt fails",
  "- normalize provider names before comparing their result lists",
  "- wait for the workspace scan to end before drawing the tree views",
  "- cache the parsed settings so repeated reads skip the disk completely",
  "- restore the previous selection after the list gets rebuilt quietly again",
  "- throttle save requests so bursts of rapid edits collapse into one final save",
  "- release the old document handles completely as soon as the next document reopens",
  "- prefer the user-defined template over the fallback defaults in every real usage case",
];

// The fixed complete sentence behind the wrap examples. Long enough (~180
// chars) to wrap for any limit inside the ladder band, and it ends with a
// full stop so no example ever ends mid-sentence.
export const WRAP_SENTENCE_WORDS: readonly string[] = [
  "every",
  "raw",
  "command",
  "output",
  "line",
  "is",
  "classified",
  "from",
  "the",
  "stream",
  "and",
  "exit",
  "code",
  "it",
  "actually",
  "carries",
  "so",
  "a",
  "passing",
  "test",
  "with",
  "the",
  "word",
  "failure",
  "in",
  "its",
  "title",
  "stays",
  "reliably",
  "normal",
  "and",
  "clean",
];

// Greedy word-boundary wrap of words into lines of at most budget chars.
function wrapWords(words: readonly string[], budget: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > budget) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

// Wraps the sentence as a bullet: "- " on the first line and a 2-space
// indent on every continuation line.
export function wrapBullet(words: readonly string[], budget: number): string {
  return wrapWords(words, budget)
    .map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
    .join("\n");
}

// Picks the example for a limit: GOOD = the largest ladder entry that fits
// under limit - 2, BAD = the smallest ladder entry that exceeds limit + 2.
// Out-of-band limits clamp to the nearest ladder entry (settings will clamp
// limits into the band later).
export function selectExample(examples: readonly string[], limit: number, mode: "good" | "bad"): string {
  if (mode === "good") {
    for (let i = examples.length - 1; i >= 0; i--) {
      if (examples[i].length <= limit - 2) {
        return examples[i];
      }
    }
    return examples[0];
  }
  for (const example of examples) {
    if (example.length >= limit + 2) {
      return example;
    }
  }
  return examples[examples.length - 1];
}

// The index of the GOOD body bullet for a limit (the largest ladder entry
// that fits under limit - 2); shared by the no-blank-line WRONG example.
function goodBodyIndex(limit: number): number {
  for (let i = BODY_EXAMPLES.length - 1; i >= 0; i--) {
    if (BODY_EXAMPLES[i].length <= limit - 2) {
      return i;
    }
  }
  return 0;
}

// Two in-band ladder bullets glued together without the required blank
// line, demonstrating that exact violation.
export function noBlankLineExample(limit: number): string {
  const goodIndex = goodBodyIndex(limit);
  const secondIndex = goodIndex > 0 ? goodIndex - 1 : 0;
  return `${BODY_EXAMPLES[goodIndex]}\n${BODY_EXAMPLES[secondIndex]}`;
}

// The wrapped sentence with the continuation indent removed, demonstrating
// that exact violation.
export function missingIndentExample(limit: number): string {
  return wrapBullet(WRAP_SENTENCE_WORDS, limit - 2).replace(/\n {2}/g, "\n");
}

// The wrapped sentence with the last word of its first line split
// mid-word, demonstrating that exact violation.
export function midWordBreakExample(limit: number): string {
  const firstLine = wrapWords(WRAP_SENTENCE_WORDS, limit - 2)[0];
  const firstLineWords = firstLine.split(" ");
  const lastWord = firstLineWords[firstLineWords.length - 1];
  const splitAt = Math.max(1, Math.floor(lastWord.length / 2));
  const head = firstLineWords.slice(0, -1).join(" ");
  const tailWords = [lastWord.slice(splitAt), ...WRAP_SENTENCE_WORDS.slice(firstLineWords.length)];
  const tail = wrapWords(tailWords, limit - 2)
    .map((line) => `  ${line}`)
    .join("\n");
  return `- ${head} ${lastWord.slice(0, splitAt)}\n${tail}`;
}

// Exported for unit tests.
// Self-check for the guarantees above: every ladder entry matches its
// declared length, the selected GOOD example fits the limit and the WRONG
// example exceeds it (when the limit falls inside the ladder band), and
// every wrapped line stays within the body limit.
export function assertExamplesValid(limits: CommitlintLimits = DEFAULT_LIMITS): void {
  for (const [type, explanation] of TYPE_EXPLANATIONS) {
    if (explanation.length < MIN_TYPE_EXPLANATION) {
      throw new Error(`TYPE_EXPLANATIONS entry "${type}" is ${explanation.length} chars, minimum is ${MIN_TYPE_EXPLANATION}`);
    }
  }

  HEADER_EXAMPLES.forEach((example, i) => {
    if (example.length !== EXAMPLE_LENGTHS[i]) {
      throw new Error(`HEADER_EXAMPLES[${i}] is ${example.length} chars, expected ${EXAMPLE_LENGTHS[i]}: "${example}"`);
    }
  });
  BODY_EXAMPLES.forEach((example, i) => {
    if (example.length !== EXAMPLE_LENGTHS[i]) {
      throw new Error(`BODY_EXAMPLES[${i}] is ${example.length} chars, expected ${EXAMPLE_LENGTHS[i]}: "${example}"`);
    }
  });

  const bandMin = EXAMPLE_LENGTHS[0] + 2;
  const bandMax = EXAMPLE_LENGTHS[EXAMPLE_LENGTHS.length - 1] - 2;

  const goodHeader = selectExample(HEADER_EXAMPLES, limits.header, "good");
  if (limits.header >= bandMin && goodHeader.length > limits.header) {
    throw new Error(`Selected GOOD header example (${goodHeader.length} chars) exceeds limit ${limits.header}: "${goodHeader}"`);
  }
  const badHeader = selectExample(HEADER_EXAMPLES, limits.header, "bad");
  if (limits.header <= bandMax && badHeader.length <= limits.header) {
    throw new Error(`Selected WRONG header example (${badHeader.length} chars) does not exceed limit ${limits.header}: "${badHeader}"`);
  }

  const goodBody = selectExample(BODY_EXAMPLES, limits.body, "good");
  if (limits.body >= bandMin && goodBody.length > limits.body) {
    throw new Error(`Selected GOOD body example (${goodBody.length} chars) exceeds limit ${limits.body}: "${goodBody}"`);
  }
  const badBody = selectExample(BODY_EXAMPLES, limits.body, "bad");
  if (limits.body <= bandMax && badBody.length <= limits.body) {
    throw new Error(`Selected WRONG body example (${badBody.length} chars) does not exceed limit ${limits.body}: "${badBody}"`);
  }

  for (const line of wrapBullet(WRAP_SENTENCE_WORDS, limits.body - 2).split("\n")) {
    if (line.length > limits.body) {
      throw new Error(`Wrapped example line (${line.length} chars) exceeds limit ${limits.body}: "${line}"`);
    }
  }
}
