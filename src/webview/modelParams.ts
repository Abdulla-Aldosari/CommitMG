// How the stored model settings are shown for the chosen model. A stored
// reasoning level the model does not offer is never sent (the host drops
// it), so the tab shows Auto and says why instead of a level that has no
// effect.

export interface ReasoningView {
  // The step to select: "auto" or one of the offered levels.
  value: string;
  // The stored level, when the model does not offer it.
  ignoredLevel: string | null;
}

export function reasoningView(stored: unknown, offered: readonly string[]): ReasoningView {
  if (stored === "auto" || typeof stored !== "string") {
    return { value: "auto", ignoredLevel: null };
  }
  return offered.includes(stored) ? { value: stored, ignoredLevel: null } : { value: "auto", ignoredLevel: stored };
}
