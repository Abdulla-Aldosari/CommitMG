// The emoji for each commit type, and how it is added to a finished
// message. The model only chooses the type; the emoji always follows from
// it, so the same type always gets the same emoji. The emojis are the
// gitmoji ones for the meaning of each type, written exactly as gitmoji
// writes them (some carry a variation selector).

export const EMOJI_POSITIONS = ["off", "beforeType", "beforeSubject"] as const;
export type EmojiPosition = (typeof EMOJI_POSITIONS)[number];
export const DEFAULT_EMOJI_POSITION: EmojiPosition = "off";

export const TYPE_EMOJIS: Readonly<Record<string, string>> = {
  feat: "\u2728",
  fix: "\u{1F41B}",
  docs: "\u{1F4DD}",
  style: "\u{1F3A8}",
  refactor: "\u267B\uFE0F",
  perf: "\u26A1\uFE0F",
  test: "\u2705",
  build: "\u{1F4E6}\uFE0F",
  ci: "\u{1F477}",
  chore: "\u{1F527}",
  revert: "\u23EA\uFE0F",
};

// Header characters kept free for the emoji: the longest emoji among the
// allowed types plus its space, counted the way commitlint counts length
// (UTF-16 code units). 0 when emojis are off or no allowed type has one.
export function emojiReserve(types: readonly string[], position: EmojiPosition): number {
  if (position === "off") {
    return 0;
  }
  const lengths = types.map((type) => TYPE_EMOJIS[type]?.length ?? 0);
  const longest = Math.max(0, ...lengths);
  return longest === 0 ? 0 : longest + 1;
}

const HEADER = /^([a-z][a-z0-9-]*)((?:\([^)]+\))?!?:) /;

// Adds the type's emoji to the header: "✨ feat(auth): add login" or
// "feat(auth): ✨ add login". A message whose header does not parse, whose
// type has no emoji, or that already carries the emoji is returned as it is.
export function applyTypeEmoji(message: string, position: EmojiPosition): string {
  if (position === "off") {
    return message;
  }
  const match = HEADER.exec(message);
  const emoji = match ? TYPE_EMOJIS[match[1]] : undefined;
  if (!match || !emoji) {
    return message;
  }
  const rest = message.slice(match[0].length);
  if (rest.startsWith(emoji)) {
    return message;
  }
  return position === "beforeType" ? `${emoji} ${message}` : `${match[1]}${match[2]} ${emoji} ${rest}`;
}
