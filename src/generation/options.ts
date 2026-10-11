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
  // Caps for the untracked-files section (new files are sent whole).
  untrackedMaxFiles: number;
  untrackedMaxBytes: number;
}

type NumericOption = { [K in keyof GenerationOptions]: GenerationOptions[K] extends number ? K : never }[keyof GenerationOptions];

// The engine defaults: the values every generation used before these knobs
// existed. The settings layer supplies the user's preset on top.
export const DEFAULT_GENERATION_OPTIONS: Readonly<GenerationOptions> = {
  includeEvidence: true,
  evidenceBudget: 48000,
  diffBudget: 40000,
  untrackedMaxFiles: 20,
  untrackedMaxBytes: 10000,
};

// Inclusive ranges for the numeric knobs; the settings UI uses the same
// bounds for its inline validation.
export const GENERATION_OPTION_RANGES: Readonly<Record<NumericOption, { min: number; max: number }>> = {
  evidenceBudget: { min: 2000, max: 200000 },
  diffBudget: { min: 4000, max: 200000 },
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
    untrackedMaxFiles: normalizeNumber("untrackedMaxFiles", input.untrackedMaxFiles),
    untrackedMaxBytes: normalizeNumber("untrackedMaxBytes", input.untrackedMaxBytes),
  };
}
