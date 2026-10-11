// Checks a custom OpenAI-compatible base URL before the API key is sent to
// it. Plain http is fine for a server on this machine (a local Ollama), but
// to any other host it sends the key and the diff unencrypted.

export type BaseUrlStatus = "empty" | "invalid" | "secure" | "local" | "insecure";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function classifyBaseUrl(raw: string): BaseUrlStatus {
  const value = raw.trim();
  if (value === "") {
    return "empty";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid";
  }
  if (url.protocol === "https:") {
    return "secure";
  }
  if (url.protocol !== "http:") {
    return "invalid";
  }
  return isLocalHost(url.hostname) ? "local" : "insecure";
}
