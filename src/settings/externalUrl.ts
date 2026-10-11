// Validates URLs the settings webview asks the host to open in the browser.
// The webview is a separate, less trusted context: only plain https links
// may leave it, so a compromised or buggy webview can never open file:,
// command:, vscode:, or other privileged URI schemes. vscode-free so it can
// be unit-tested.

// Returns the normalized https URL, or null when the URL must not be opened.
export function safeExternalUrl(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
