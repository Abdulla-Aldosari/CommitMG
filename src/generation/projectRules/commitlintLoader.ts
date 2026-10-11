// Finds the project's commitlint config in the repository root, the way
// commitlint itself does, and loads it in a separate Node process that
// returns only the fields the engine reads (rules and baseScopes) as plain
// JSON. A JavaScript config is code from the repository; running it in a
// child process means a broken, slow, or hanging config can never block or
// crash the extension host, and nothing stays behind in the host's module
// cache. JSON configs go through the same process, so every format is read
// one way.
//
// Trust model: the extension is not declared for untrusted workspaces, so
// VS Code keeps it disabled there and this loader only ever runs in folders
// the user trusts (the same trust a commit hook relies on when it runs the
// same file).

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

export const COMMITLINT_CONFIG_FILE = "commitlint.config.js";

// A config that takes longer than this is treated as broken.
export const COMMITLINT_LOAD_TIMEOUT_MS = 10000;

// How a config file is read: "module" is a JavaScript file (CommonJS or ES
// module), "json" a JSON file, "package" the commitlint field of
// package.json. "unsupported" is a format that would need a library this
// extension does not ship (TypeScript, YAML).
export type CommitlintConfigFormat = "module" | "json" | "package" | "unsupported";

// The places commitlint searches, in its own order; the first one that
// holds a config wins.
const SEARCH_PLACES: ReadonlyArray<{ file: string; format: CommitlintConfigFormat }> = [
  { file: "package.json", format: "package" },
  { file: "package.yaml", format: "unsupported" },
  { file: ".commitlintrc", format: "json" },
  { file: ".commitlintrc.json", format: "json" },
  { file: ".commitlintrc.yaml", format: "unsupported" },
  { file: ".commitlintrc.yml", format: "unsupported" },
  { file: ".commitlintrc.js", format: "module" },
  { file: ".commitlintrc.cjs", format: "module" },
  { file: ".commitlintrc.mjs", format: "module" },
  { file: "commitlint.config.js", format: "module" },
  { file: "commitlint.config.cjs", format: "module" },
  { file: "commitlint.config.mjs", format: "module" },
  { file: ".commitlintrc.ts", format: "unsupported" },
  { file: ".commitlintrc.cts", format: "unsupported" },
  { file: ".commitlintrc.mts", format: "unsupported" },
  { file: "commitlint.config.ts", format: "unsupported" },
  { file: "commitlint.config.cts", format: "unsupported" },
  { file: "commitlint.config.mts", format: "unsupported" },
];

export interface CommitlintConfigLocation {
  // Repository-relative file name.
  file: string;
  format: CommitlintConfigFormat;
  // The file text, for the commented scope-list fallback.
  text: string;
}

// The commitlint config in the repository root, or null when there is none.
// Like commitlint, an empty file is skipped, and package.json counts only
// when it has a commitlint field. A package.yaml counts when a top-level
// commitlint key appears in it. An extension-less .commitlintrc is JSON or
// YAML; only JSON can be read.
export function findCommitlintConfig(repoRoot: string): CommitlintConfigLocation | null {
  for (const place of SEARCH_PLACES) {
    const fullPath = path.join(repoRoot, place.file);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    const text = fs.readFileSync(fullPath, "utf8");
    if (text.trim() === "") {
      continue;
    }
    if (place.file === "package.json") {
      if (hasCommitlintField(text)) {
        return { file: place.file, format: "package", text };
      }
      continue;
    }
    if (place.file === "package.yaml") {
      if (/^commitlint\s*:/m.test(text)) {
        return { file: place.file, format: "unsupported", text };
      }
      continue;
    }
    if (place.file === ".commitlintrc") {
      return { file: place.file, format: isJson(text) ? "json" : "unsupported", text };
    }
    return { file: place.file, format: place.format, text };
  }
  return null;
}

function hasCommitlintField(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).commitlint != null;
  } catch {
    return false;
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// The only parts of a commitlint config the engine reads.
export interface CommitlintConfigData {
  rules: Record<string, unknown>;
  baseScopes: unknown;
}

// The outcome of loading the project's commitlint config: its rules, or
// the name of a config in a format that cannot be read.
export type CommitlintConfigResult =
  | {
      status: "loaded";
      // Repository-relative name of the config file that was loaded.
      file: string;
      data: CommitlintConfigData;
      // Raw file text, read for the commented scope-list fallback.
      text: string;
    }
  | { status: "unsupported"; file: string };

// Marks where the JSON result starts, so anything the config itself prints
// to stdout cannot corrupt the result.
const RESULT_MARKER = "\n<<COMMITMG_COMMITLINT_RESULT>>";

// Runs inside the child process. The config path and its format arrive as
// arguments (never interpolated into code). CommonJS configs are loaded
// with require(); ES module configs (an .mjs file, or a .js file in a
// "type": "module" package) are loaded with import(), whose default export
// is the config. JSON configs and the commitlint field of package.json are
// parsed, never executed.
const LOADER_SCRIPT = `
"use strict";
const fs = require("fs");
const { pathToFileURL } = require("url");
const marker = ${JSON.stringify(RESULT_MARKER)};
const configPath = process.argv[1];
const format = process.argv[2];

function pick(config) {
  const value = config && typeof config === "object" && "default" in config && !("rules" in config) ? config.default : config;
  const rules = value && typeof value.rules === "object" && value.rules !== null ? value.rules : {};
  return { rules, baseScopes: value ? value.baseScopes : undefined };
}

async function loadModule() {
  try {
    return require(configPath);
  } catch (error) {
    if (error && (error.code === "ERR_REQUIRE_ESM" || error.code === "ERR_REQUIRE_ASYNC_MODULE")) {
      return import(pathToFileURL(configPath).href);
    }
    throw error;
  }
}

async function load() {
  if (format === "json") {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  if (format === "package") {
    return JSON.parse(fs.readFileSync(configPath, "utf8")).commitlint;
  }
  return loadModule();
}

load()
  .then((config) => {
    process.stdout.write(marker + JSON.stringify({ ok: true, data: pick(config) }));
  })
  .catch((error) => {
    const message = error && error.message ? String(error.message) : String(error);
    process.stdout.write(marker + JSON.stringify({ ok: false, error: message }));
  });
`;

// Returns null when the repository has no commitlint config, and an
// "unsupported" result for a config in a format this extension cannot read.
// Throws a user-facing error when the config fails, times out, or returns
// garbage. timeoutMs exists for tests; callers use the default.
export async function loadCommitlintConfig(repoRoot: string, timeoutMs: number = COMMITLINT_LOAD_TIMEOUT_MS): Promise<CommitlintConfigResult | null> {
  const location = findCommitlintConfig(repoRoot);
  if (!location) {
    return null;
  }
  if (location.format === "unsupported") {
    return { status: "unsupported", file: location.file };
  }
  const data = await runLoader(location, repoRoot, timeoutMs);
  return { status: "loaded", file: location.file, data, text: location.text };
}

function runLoader(location: CommitlintConfigLocation, repoRoot: string, timeoutMs: number): Promise<CommitlintConfigData> {
  const file = path.join(repoRoot, location.file);
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["-e", LOADER_SCRIPT, file, location.format],
      {
        cwd: repoRoot,
        // process.execPath is the editor's Electron binary inside VS Code;
        // this variable makes it behave as plain Node. Plain Node ignores it.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: timeoutMs,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout) => {
        const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
        if (markerIndex === -1) {
          const reason = error && error.killed ? `it did not finish within ${timeoutMs / 1000} seconds` : (error?.message ?? "it produced no result");
          reject(new Error(`Could not load ${location.file}: ${reason}`));
          return;
        }
        try {
          resolve(parseLoaderResult(stdout.slice(markerIndex + RESULT_MARKER.length), location.file));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

// Exported for unit tests.
// Validates the child's JSON result and normalizes it to CommitlintConfigData.
export function parseLoaderResult(json: string, file: string = COMMITLINT_CONFIG_FILE): CommitlintConfigData {
  let result: unknown;
  try {
    result = JSON.parse(json);
  } catch {
    throw new Error(`Could not load ${file}: the loader returned invalid output`);
  }
  const value = result as { ok?: unknown; error?: unknown; data?: { rules?: unknown; baseScopes?: unknown } };
  if (value.ok !== true) {
    const reason = typeof value.error === "string" && value.error ? value.error : "unknown error";
    throw new Error(`Could not load ${file}: ${reason}`);
  }
  const rules = value.data && typeof value.data.rules === "object" && value.data.rules !== null ? (value.data.rules as Record<string, unknown>) : {};
  return { rules, baseScopes: value.data ? value.data.baseScopes : undefined };
}
