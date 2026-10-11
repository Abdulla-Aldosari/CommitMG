// The prompt size line of the Speed & Context tab: what the host measured
// for the current changes, turned into one sentence. The host builds the
// real prompt (the same one a generation would send) and counts it; this
// module only words the result.

export interface PromptSizeResult {
  success: boolean;
  // Present when success is true.
  tokens?: number;
  chars?: number;
  style?: string;
  repoName?: string;
  // Present when success is false.
  message?: string;
}

export interface PromptSizeView {
  kind: "info" | "warning";
  message: string;
}

const STYLE_LABELS: Readonly<Record<string, string>> = { lengthy: "Lengthy", medium: "Medium", short: "Short", titleOnly: "Title only" };

export function promptSizeView(result: PromptSizeResult): PromptSizeView {
  if (!result.success || result.tokens === undefined || result.chars === undefined) {
    return { kind: "warning", message: `Prompt size not measured: ${result.message || "unknown error"}` };
  }
  const style = STYLE_LABELS[result.style ?? ""] ?? result.style ?? "";
  const repo = result.repoName ? ` in ${result.repoName}` : "";
  return {
    kind: "info",
    message: `Each request sends about ${result.tokens.toLocaleString("en-US")} tokens (${result.chars.toLocaleString("en-US")} characters) with these settings, measured on the current changes${repo} for the ${style} style.`,
  };
}

// A key for the settings that change the prompt, so the tab measures again
// only when one of them changed.
export function promptSizeKey(effectiveOptions: unknown): string {
  return JSON.stringify(effectiveOptions);
}
