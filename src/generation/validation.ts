// Deterministic post-generation checks: lengths, layout, and header
// metadata (type and scope).

import { DEFAULT_COMMIT_TYPES, DEFAULT_LIMITS, type CommitlintLimits, type CommitStyle, type ScopeMapEntry } from "./types";

// ===================== HEADER META =====================

// Exported for unit tests.
// Deterministic header-metadata checks: the type must be one of the
// project's allowed types, the scope must be in the accepted list, and when
// the scope map resolved the changed files deterministically, the header
// must use one of the resolved scopes. Problems are phrased for the
// correction prompt, so the single retry can fix them verbatim.
export function validateHeaderMeta(
  message: string,
  acceptedScopes: readonly string[] | null,
  resolved: readonly ScopeMapEntry[],
  allowedTypes: readonly string[] = DEFAULT_COMMIT_TYPES,
): string[] {
  const problems: string[] = [];
  const header = message.split(/\r?\n/, 1)[0] || "";
  // A type is lowercase; digits and hyphens let a project's own types
  // (such as i18n or deps-dev) through to the allowed-type check.
  const match = /^([a-z][a-z0-9-]*)(?:\(([^)]+)\))?!?:\s/.exec(header);
  if (!match) {
    // Not a message at all (a code fence, an explanation, leaked reasoning)
    // or a header in the wrong shape. Either way it must not pass as valid.
    const shown = header.length > 60 ? `${header.slice(0, 60)}...` : header;
    problems.push(`the first line must be a header shaped "type(scope): subject" or "type: subject", but it is "${shown}"`);
    return problems;
  }

  const [, type, scope] = match;
  if (!allowedTypes.includes(type)) {
    problems.push(`type "${type}" is not allowed (allowed: ${allowedTypes.join(", ")})`);
  }
  if (scope !== undefined && acceptedScopes && !acceptedScopes.includes(scope)) {
    problems.push(`scope "${scope}" is not in the accepted scope list`);
  }
  if (scope !== undefined && resolved.length > 0 && !resolved.some((entry) => entry.scope === scope)) {
    const expected = resolved.map((entry) => entry.scope).join(" | ");
    problems.push(`scope should be "${expected}" - the changed files map to it`);
  }

  return problems;
}

// ===================== VALIDATION =====================

// Exported for unit tests.
// Deterministic post-generation checks. AI models cannot count characters
// reliably, so the enforced limits are verified here in code instead of
// being left to the model's judgement. Returns a list of human-readable
// problems describing every violated rule; an empty list means the message
// passes every check. Four rules are checked:
//   1. Header length <= limits.header.
//   2. Every body line (including 2-space continuation lines) <= limits.body.
//   3. Every bullet point is preceded by a blank line (this also enforces
//      the blank line required between the header and the first bullet).
//   4. medium style produces at most 4 bullets, matching the "2 to 4"
//      instruction in its body rules.
// The problems are phrased for the correction prompt: each entry is fed
// back to the model verbatim so it knows exactly what to fix on the retry.
export function validateCommitMessage(message: string, style: CommitStyle, limits: CommitlintLimits = DEFAULT_LIMITS): string[] {
  const problems: string[] = [];
  // Split the message into its header (first line) and body (the rest).
  const lines = message.split(/\r?\n/);
  const header = lines[0] || "";
  const body = lines.slice(1);

  // Check 1: the header (type + scope + subject) must fit the limit.
  if (header.length > limits.header) {
    problems.push(`header is ${header.length} chars (max ${limits.header})`);
  }

  // Check 2: no body line may exceed the limit. Line numbers are reported
  // as they appear in the file (header is line 1, body starts at line 2).
  body.forEach((line, i) => {
    if (line.length > limits.body) {
      problems.push(`body line ${i + 2} is ${line.length} chars (max ${limits.body})`);
    }
  });

  // Check 3: blank line before every bullet. body[i] sits on overall line
  // i + 2, so its predecessor is lines[i] - except for the very first body
  // line, whose predecessor is the header itself.
  body.forEach((line, i) => {
    if (!line.startsWith("- ")) return;
    const prev = i === 0 ? header : lines[i];
    if (prev.trim() !== "") {
      problems.push(`bullet on line ${i + 2} is not preceded by a blank line`);
    }
  });

  // Check 4: cap the bullet count for medium only. lengthy is intentionally
  // uncapped (it promises a thorough explanation) and short/titleOnly do
  // not use bullets at all, so only medium carries this limit.
  const bulletCount = body.filter((line) => line.startsWith("- ")).length;
  if (style === "medium" && bulletCount > 4) {
    problems.push(`medium style allows at most 4 bullets, found ${bulletCount}`);
  }

  return problems;
}
