// The value math behind the step slider component: a knob that snaps to a
// fixed, ordered list of values. Pure, so the DOM component stays a thin
// layer over these functions.

export function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(count - 1, Math.round(index)));
}

// The index a slider starts on: the given value's position, or the first
// value when it is not in the list.
export function initialIndex(values: readonly string[], value: string | null | undefined): number {
  const index = value === null || value === undefined ? -1 : values.indexOf(value);
  return index < 0 ? 0 : index;
}

// Where value `index` sits along the bar, from 0 (left end) to 1 (right
// end). A single value sits at the left end.
export function fractionFor(index: number, count: number): number {
  return count <= 1 ? 0 : clampIndex(index, count) / (count - 1);
}

// The nearest value to a pointer position, given as the fraction of the
// bar's width it lies at (anything outside the bar clamps to an end).
export function indexAtFraction(fraction: number, count: number): number {
  if (count <= 1 || !Number.isFinite(fraction)) {
    return 0;
  }
  return clampIndex(fraction * (count - 1), count);
}

// The index a key press moves to, or null for a key the slider ignores.
export function indexAfterKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
    case "PageDown":
      return clampIndex(index - 1, count);
    case "ArrowRight":
    case "ArrowUp":
    case "PageUp":
      return clampIndex(index + 1, count);
    case "Home":
      return 0;
    case "End":
      return clampIndex(count - 1, count);
    default:
      return null;
  }
}
