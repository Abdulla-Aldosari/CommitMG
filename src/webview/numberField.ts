// Parses and checks what the user types into a number field, so the field
// can show an inline error and never posts an out-of-range value.

export interface NumberRules {
  min: number;
  max: number;
  // Whole numbers only (token counts, line counts, seconds).
  integer: boolean;
  // When true, an empty field is a valid "use the default" (Auto) value.
  allowEmpty: boolean;
}

export type NumberParseResult = { ok: true; value: number | null } | { ok: false; error: string };

// Matches a plain decimal number: optional sign, digits, optional fraction.
// Rejects exponents, hex, and stray characters that Number() would accept.
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function formatBound(value: number): string {
  return value.toLocaleString("en-US");
}

export function parseNumberInput(raw: string, rules: NumberRules): NumberParseResult {
  const text = raw.trim().replace(/[,_\s]/g, "");
  if (text === "") {
    return rules.allowEmpty ? { ok: true, value: null } : { ok: false, error: "Enter a number." };
  }
  if (!PLAIN_NUMBER.test(text)) {
    return { ok: false, error: "Enter a number." };
  }
  const value = Number(text);
  if (rules.integer && !Number.isInteger(value)) {
    return { ok: false, error: "Enter a whole number." };
  }
  if (value < rules.min || value > rules.max) {
    return { ok: false, error: `Enter a value from ${formatBound(rules.min)} to ${formatBound(rules.max)}.` };
  }
  return { ok: true, value };
}
