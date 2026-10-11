import type { TypeGuide } from "./prompt/typeGuide";
import { BULLET_SPACINGS, DEFAULT_BULLET_SPACING, MAX_ADDITIONAL_INSTRUCTIONS_LENGTH, type BulletSpacing } from "./types";

// The knobs that trade prompt size (and so speed and cost) against how much
// of the change the model sees. The engine reads them only through
// normalizeOptions(), so a missing, out-of-range, or malformed value (a
// hand-edited settings.json) always falls back to a safe number.

export interface GenerationOptions {
  // Send the committed version of each changed file as extra context.
  includeEvidence: boolean;
  // Character budget for that old-file evidence, across all files.
  evidenceBudget: number;
  // Character cap for the diff text.
  diffBudget: number;
  // Unchanged lines shown around each change (git diff -U<n>).
  diffContextLines: number;
  // Leave whitespace-only changes out of the diff (git diff -w).
  ignoreWhitespace: boolean;
  // Glob patterns (git pathspec glob syntax) of files whose diff is not
  // sent; they stay in the summary so the model knows they changed.
  excludePatterns: string[];
  // The commit type guide in the system prompt: a full paragraph per type,
  // or a one-line compact version.
  typeGuide: TypeGuide;
  // Caps for the untracked-files section (new files are sent whole).
  untrackedMaxFiles: number;
  untrackedMaxBytes: number;
  // How body bullets are separated; the prompt teaches it and the
  // validation checks it.
  bulletSpacing: BulletSpacing;
  // The user's own instructions, added to the prompt below the rules.
  additionalInstructions: string;
}

type NumericOption = { [K in keyof GenerationOptions]: GenerationOptions[K] extends number ? K : never }[keyof GenerationOptions];

// The engine defaults. The prompt-size values are what every generation
// used before these knobs existed; the settings layer supplies the user's
// preset on top.
export const DEFAULT_GENERATION_OPTIONS: Readonly<GenerationOptions> = {
  includeEvidence: true,
  evidenceBudget: 48000,
  diffBudget: 40000,
  // git's own default.
  diffContextLines: 3,
  ignoreWhitespace: false,
  // Generated files whose diff says nothing about the intent of a change.
  excludePatterns: ["**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/*.min.js", "**/*.map"],
  typeGuide: "full",
  untrackedMaxFiles: 20,
  untrackedMaxBytes: 10000,
  bulletSpacing: DEFAULT_BULLET_SPACING,
  additionalInstructions: "",
};

// Line breaks become "\n", control characters other than "\n" and tab are
// dropped (they could hide text or break the prompt's layout), the text is
// trimmed, and it is cut to the maximum length.
export function normalizeAdditionalInstructions(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = [...value.replace(/\r\n?/g, "\n")].filter((char) => {
    const code = char.charCodeAt(0);
    return char === "\n" || char === "\t" || (code >= 0x20 && code !== 0x7f);
  });
  return cleaned.join("").trim().slice(0, MAX_ADDITIONAL_INSTRUCTIONS_LENGTH).trim();
}

export const MAX_EXCLUDE_PATTERNS = 50;
export const MAX_EXCLUDE_PATTERN_LENGTH = 200;

// Why a pattern cannot be used, or null when it can. Patterns become git
// pathspecs, so they are checked before they reach git: no control
// characters (a newline or NUL could split the argument), and no leading
// ':' (pathspec magic of its own).
export function excludePatternProblem(pattern: string): string | null {
  if (pattern.trim() === "") {
    return "Enter a pattern.";
  }
  if (pattern.length > MAX_EXCLUDE_PATTERN_LENGTH) {
    return `Keep a pattern under ${MAX_EXCLUDE_PATTERN_LENGTH} characters.`;
  }
  if ([...pattern].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return "A pattern cannot contain control characters.";
  }
  if (pattern.startsWith(":")) {
    return "A pattern cannot start with ':'.";
  }
  if (pattern.startsWith("/") || /^[A-Za-z]:[\\/]/.test(pattern) || pattern.split(/[\\/]/).includes("..")) {
    return "Use a pattern relative to the repository root, without '..'.";
  }
  return null;
}

// Keeps the usable, distinct patterns, trimmed, up to the limit.
export function normalizeExcludePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_GENERATION_OPTIONS.excludePatterns];
  }
  const patterns = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  return [...new Set(patterns.filter((pattern) => excludePatternProblem(pattern) === null))].slice(0, MAX_EXCLUDE_PATTERNS);
}

// The context line counts the settings offer.
export const DIFF_CONTEXT_LINE_STEPS: readonly number[] = [0, 1, 2, 3, 5, 10];

// Inclusive ranges for the numeric knobs; the settings UI uses the same
// bounds for its inline validation.
export const GENERATION_OPTION_RANGES: Readonly<Record<NumericOption, { min: number; max: number }>> = {
  evidenceBudget: { min: 2000, max: 200000 },
  diffBudget: { min: 4000, max: 200000 },
  diffContextLines: { min: 0, max: 10 },
  untrackedMaxFiles: { min: 1, max: 200 },
  untrackedMaxBytes: { min: 1000, max: 200000 },
};

function normalizeNumber(key: NumericOption, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GENERATION_OPTIONS[key];
  }
  const { min, max } = GENERATION_OPTION_RANGES[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeOptions(input: Partial<GenerationOptions> = {}): GenerationOptions {
  return {
    includeEvidence: typeof input.includeEvidence === "boolean" ? input.includeEvidence : DEFAULT_GENERATION_OPTIONS.includeEvidence,
    evidenceBudget: normalizeNumber("evidenceBudget", input.evidenceBudget),
    diffBudget: normalizeNumber("diffBudget", input.diffBudget),
    diffContextLines: normalizeNumber("diffContextLines", input.diffContextLines),
    ignoreWhitespace: typeof input.ignoreWhitespace === "boolean" ? input.ignoreWhitespace : DEFAULT_GENERATION_OPTIONS.ignoreWhitespace,
    excludePatterns: normalizeExcludePatterns(input.excludePatterns),
    typeGuide: input.typeGuide === "compact" || input.typeGuide === "full" ? input.typeGuide : DEFAULT_GENERATION_OPTIONS.typeGuide,
    untrackedMaxFiles: normalizeNumber("untrackedMaxFiles", input.untrackedMaxFiles),
    untrackedMaxBytes: normalizeNumber("untrackedMaxBytes", input.untrackedMaxBytes),
    bulletSpacing: (BULLET_SPACINGS as readonly unknown[]).includes(input.bulletSpacing) ? (input.bulletSpacing as BulletSpacing) : DEFAULT_GENERATION_OPTIONS.bulletSpacing,
    additionalInstructions: normalizeAdditionalInstructions(input.additionalInstructions),
  };
}
