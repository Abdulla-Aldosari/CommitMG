// The sample messages of the Message Format tab's View Examples window: one
// per detail level, in the current convention, emoji position, bullet
// spacing, and project limits. Built by the same code that shapes a real
// message (the wrap rule and the emoji table), with no model request, so
// they show the form a generated message takes, not its content.

import { applyTypeEmoji, emojiReserve, type EmojiPosition } from "../generation/format/typeEmoji";
import { wrapBullet } from "../generation/prompt/examples";
import { COMMIT_STYLES, type BulletSpacing, type CommitStyle, type Convention } from "../generation/types";

export interface FormatExampleInput {
  convention: Convention;
  emojiPosition: EmojiPosition;
  bulletSpacing: BulletSpacing;
  limits: { header: number; body: number };
  types: readonly string[];
}

export interface FormatExample {
  style: CommitStyle;
  label: string;
  message: string;
}

const STYLE_LABELS: Readonly<Record<CommitStyle, string>> = { lengthy: "Lengthy", medium: "Medium", short: "Short", titleOnly: "Title only" };

// One change told at every detail level: the header candidates run from
// the most to the least detailed, and the longest one that fits the limit
// is used. Each is a fix in the auth scope, so the type emoji is the fix
// emoji.
const CONVENTIONAL_HEADERS = [
  "fix(auth): refresh the session token before it expires, not after a failed request",
  "fix(auth): refresh the session token before it expires",
  "fix(auth): refresh the token before it expires",
  "fix(auth): refresh tokens early",
];
const BASIC_HEADERS = [
  "Refresh the session token before it expires, not after a failed request",
  "Refresh the session token before it expires",
  "Refresh the token before it expires",
  "Refresh tokens early",
];
const REASON_WORDS = "Token refresh ran only after a failed request, so the first call after a long idle period always failed".split(" ");
const BULLET_WORDS: ReadonlyArray<readonly string[]> = [
  "refresh the token before it expires instead of after the first failure".split(" "),
  "keep the old token until the new one arrives, so parallel requests never send an empty one".split(" "),
  "cover the idle case with a test that waits past the expiry time".split(" "),
];

export function formatExamples(input: FormatExampleInput): FormatExample[] {
  const header = exampleHeader(input);
  const body = input.limits.body;
  const separator = input.bulletSpacing === "compact" ? "\n" : "\n\n";
  const bullets = (count: number): string =>
    BULLET_WORDS.slice(0, count)
      .map((words) => wrapBullet(words, body - 2))
      .join(separator);
  const reason = wrapBullet(REASON_WORDS, body - 2)
    .replace(/^- /, "")
    .replace(/\n {2}/g, "\n");
  const bodies: Readonly<Record<CommitStyle, string>> = {
    lengthy: `${reason}.\n\n${bullets(3)}`,
    medium: bullets(2),
    short: "The first call after an idle period no longer fails.",
    titleOnly: "",
  };
  return COMMIT_STYLES.map((style) => ({
    style,
    label: STYLE_LABELS[style],
    message: bodies[style] === "" ? header : `${header}\n\n${bodies[style]}`,
  }));
}

// The longest header candidate that fits the limit the model writes to,
// with the emoji added, so the sample header always fits the real limit.
function exampleHeader(input: FormatExampleInput): string {
  if (input.convention === "basic") {
    return longestFitting(BASIC_HEADERS, input.limits.header);
  }
  const modelLimit = input.limits.header - emojiReserve(input.types, input.emojiPosition);
  return applyTypeEmoji(longestFitting(CONVENTIONAL_HEADERS, modelLimit), input.emojiPosition);
}

function longestFitting(candidates: readonly string[], limit: number): string {
  return candidates.find((candidate) => candidate.length <= limit) ?? candidates[candidates.length - 1];
}
