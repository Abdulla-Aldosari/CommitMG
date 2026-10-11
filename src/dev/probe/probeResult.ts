// Turns one probe HTTP response into a compact, secret-free record: whether
// the model accepted the request, the provider's error text when it did not,
// the structural shape of the reply (key paths and value types, never the
// text itself), and a few signal values (finish reasons, token usage).
// Pure and vscode-free so it is unit-tested.

export type ProbeStatus = "accepted" | "rejected" | "rate_limited" | "network_error" | "cancelled";

export interface ProbeOutcome {
  caseId: string;
  status: ProbeStatus;
  httpStatus?: number;
  error?: string;
  latencyMs: number;
  shape?: Record<string, string>;
  signals?: Record<string, string | number>;
}

const MAX_ERROR_LENGTH = 400;
const MAX_SHAPE_DEPTH = 6;
const SIGNAL_KEYS: readonly string[] = ["finish_reason", "stop_reason", "finishReason", "blockReason"];
const USAGE_KEYS: readonly string[] = ["usage", "usageMetadata"];

// Records every key path with the type of its value. Arrays record their
// length, describe their first element, and list the distinct "type" values
// of their object elements (how content-block arrays reveal thinking vs text
// blocks).
export function describeShape(value: unknown, path: string = "", depth: number = 0, out: Record<string, string> = {}): Record<string, string> {
  const at = path === "" ? "$" : path;
  if (Array.isArray(value)) {
    out[at] = `array(${value.length})`;
    const types = [
      ...new Set(value.map((item) => (item && typeof item === "object" && typeof (item as { type?: unknown }).type === "string" ? (item as { type: string }).type : ""))),
    ].filter((type) => type !== "");
    if (types.length > 0) {
      out[`${at}[*].type`] = types.join("|");
    }
    if (value.length > 0 && depth < MAX_SHAPE_DEPTH) {
      describeShape(value[0], `${at}[0]`, depth + 1, out);
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_SHAPE_DEPTH) {
      out[at] = "object";
      return out;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      describeShape(child, path === "" ? key : `${path}.${key}`, depth + 1, out);
    }
    return out;
  }
  out[at] = value === null ? "null" : typeof value;
  return out;
}

// Collects finish reasons and numeric token usage. Values only, never text.
export function collectSignals(value: unknown, path: string = "", out: Record<string, string | number> = {}, inUsage: boolean = false): Record<string, string | number> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSignals(item, `${path}[${index}]`, out, inUsage));
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      if (SIGNAL_KEYS.includes(key) && typeof child === "string") {
        out[childPath] = child;
      } else if (inUsage && typeof child === "number") {
        out[childPath] = child;
      } else {
        collectSignals(child, childPath, out, inUsage || USAGE_KEYS.includes(key));
      }
    }
  }
  return out;
}

// Extracts the provider's own error message from a failed response body.
export function extractProbeError(bodyText: string): string {
  let message = bodyText.trim();
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } | unknown; message?: unknown };
    const nested = parsed.error && typeof parsed.error === "object" ? (parsed.error as { message?: unknown }).message : undefined;
    if (typeof nested === "string" && nested.trim()) {
      message = nested.trim();
    } else if (typeof parsed.error === "string" && parsed.error.trim()) {
      message = parsed.error.trim();
    } else if (typeof parsed.message === "string" && parsed.message.trim()) {
      message = parsed.message.trim();
    }
  } catch {
    // Not JSON: keep the raw text.
  }
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}...` : message;
}

// Classifies one completed HTTP exchange.
export function summarizeResponse(caseId: string, httpStatus: number, bodyText: string, latencyMs: number): ProbeOutcome {
  if (httpStatus === 429) {
    return { caseId, status: "rate_limited", httpStatus, error: extractProbeError(bodyText), latencyMs };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { caseId, status: "rejected", httpStatus, error: extractProbeError(bodyText), latencyMs };
  }
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { caseId, status: "accepted", httpStatus, error: "Response body is not JSON", latencyMs };
  }
  return { caseId, status: "accepted", httpStatus, latencyMs, shape: describeShape(json), signals: collectSignals(json) };
}

// Seconds to wait before retrying a rate-limited request, from the
// Retry-After header when present, else an increasing fallback. Capped.
export function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const MAX_DELAY_MS = 30000;
  const seconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1000), MAX_DELAY_MS);
  }
  return Math.min([5000, 15000, 30000][Math.min(attempt, 2)], MAX_DELAY_MS);
}
