// Shared fetch-based HTTP helpers for every direct-API provider client.
// Extracted from the fetchJson() previously embedded in commitMessage.ts so
// every provider file (gemini, openaiCompatible, anthropic, mistral, cohere)
// shares the exact same error-wrapping behavior.

export async function fetchJson(url: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return response.json();
}

// Returns both the parsed JSON body and the raw Response, so callers that
// need rate-limit headers (x-ratelimit-*, anthropic-ratelimit-*, etc.) can
// read them without a second request.
export async function fetchJsonWithResponse(url: string, options: RequestInit): Promise<{ data: unknown; response: Response }> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} from ${url}: ${body}`);
  }
  return { data: await response.json(), response };
}

// Parses an integer out of a response header, returning null when absent or
// not a finite number. Shared by every provider's checkRateLimits().
export function parseIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) {
    return null;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

// Parses a duration header formatted like "6m0s" / "7.66s" / "1h2m3s" into a
// whole number of seconds, returning null when absent or unparsable. Shared
// by OpenAI, Groq (same header naming) and Mistral.
export function parseDurationHeaderSeconds(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) {
    return null;
  }
  const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
  if (!match) {
    return null;
  }
  const hours = parseFloat(match[1] || "0");
  const minutes = parseFloat(match[2] || "0");
  const seconds = parseFloat(match[3] || "0");
  return Math.round(hours * 3600 + minutes * 60 + seconds);
}
