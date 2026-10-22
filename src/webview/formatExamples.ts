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

// Escapes the four characters that could break out of the element the text is
// inserted into. The rendered message is plain text inside <pre>/<span>, so no
// attribute quoting is needed.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The rendered markup for one View Examples entry. The message is split into
// its structural parts and each part is wrapped in a themed span, so the
// preview shows the shape of the commit (type, scope, subject, body) instead
// of one uniform block of text. Every piece of the original message is
// escaped before it is embedded.
export function formatExampleHtml(example: FormatExample): string {
  const headerLine = example.message.split("\n", 1)[0] ?? "";
  const bodyLines = example.message.slice(headerLine.length).replace(/^\n/, "").split("\n");
  const headerParts = headerLine.match(/^(\S+\s+)?([a-z]+)(\([^)]*\))?:\s*([\s\S]*)$/);
  const headerHtml = headerParts
    ? `<span class="fm-emoji">${escapeHtml(headerParts[1] ?? "")}</span><span class="fm-type">${escapeHtml(headerParts[2])}</span><span class="fm-scope">${escapeHtml(headerParts[3] ?? "")}</span>: <span class="fm-subject">${escapeHtml(headerParts[4])}</span>`
    : `<span class="fm-subject">${escapeHtml(headerLine)}</span>`;
  const bodyHtml = bodyLines
    .filter((line) => line !== "")
    .map((line) => `<span class="${line.startsWith("- ") ? "fm-bullet" : "fm-body"}">${escapeHtml(line)}</span>`)
    .join("\n");
  return `<section class="format-example">\n  <h4 class="format-example-title">${escapeHtml(example.label)}</h4>\n  <pre class="format-example-message">${headerHtml}${bodyHtml ? `\n\n${bodyHtml}` : ""}</pre>\n</section>`;
}
