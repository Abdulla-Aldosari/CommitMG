// Loads the project's commitlint.config.js in a separate Node process and
// returns only the fields the engine reads (rules and baseScopes) as plain
// JSON. The config is code from the repository; running it in a child
// process means a broken, slow, or hanging config can never block or crash
// the extension host, and nothing stays behind in the host's module cache.
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

// The only parts of a commitlint config the engine reads.
export interface CommitlintConfigData {
  rules: Record<string, unknown>;
  baseScopes: unknown;
}

export interface LoadedCommitlintConfig {
  // Repository-relative name of the config file that was loaded.
  file: string;
  data: CommitlintConfigData;
  // Raw file text, read for the commented scope-list fallback.
  text: string;
}

// Marks where the JSON result starts, so anything the config itself prints
// to stdout cannot corrupt the result.
const RESULT_MARKER = "\n<<COMMITMG_COMMITLINT_RESULT>>";

// Runs inside the child process. The config path arrives as an argument
// (never interpolated into code). CommonJS configs are loaded with require();
// ES module configs (an .mjs file, or a .js file in a "type": "module"
// package) are loaded with import(), whose default export is the config.
const LOADER_SCRIPT = `
"use strict";
const { pathToFileURL } = require("url");
const marker = ${JSON.stringify(RESULT_MARKER)};
const configPath = process.argv[1];

function pick(config) {
  const value = config && typeof config === "object" && "default" in config && !("rules" in config) ? config.default : config;
  const rules = value && typeof value.rules === "object" && value.rules !== null ? value.rules : {};
  return { rules, baseScopes: value ? value.baseScopes : undefined };
}

async function load() {
  try {
    return require(configPath);
  } catch (error) {
    if (error && (error.code === "ERR_REQUIRE_ESM" || error.code === "ERR_REQUIRE_ASYNC_MODULE")) {
      return import(pathToFileURL(configPath).href);
    }
    throw error;
  }
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

// Returns null when the repository has no commitlint.config.js. Throws a
// user-facing error when the config fails, times out, or returns garbage.
// timeoutMs exists for tests; callers use the default.
export async function loadCommitlintConfig(repoRoot: string, timeoutMs: number = COMMITLINT_LOAD_TIMEOUT_MS): Promise<LoadedCommitlintConfig | null> {
  const file = path.join(repoRoot, COMMITLINT_CONFIG_FILE);
  if (!fs.existsSync(file)) {
    return null;
  }
  const text = fs.readFileSync(file, "utf8");
  const data = await runLoader(file, repoRoot, timeoutMs);
  return { file: COMMITLINT_CONFIG_FILE, data, text };
}

function runLoader(file: string, repoRoot: string, timeoutMs: number): Promise<CommitlintConfigData> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["-e", LOADER_SCRIPT, file],
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
          reject(new Error(`Could not load ${COMMITLINT_CONFIG_FILE}: ${reason}`));
          return;
        }
        try {
          resolve(parseLoaderResult(stdout.slice(markerIndex + RESULT_MARKER.length)));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

// Exported for unit tests.
// Validates the child's JSON result and normalizes it to CommitlintConfigData.
export function parseLoaderResult(json: string): CommitlintConfigData {
  let result: unknown;
  try {
    result = JSON.parse(json);
  } catch {
    throw new Error(`Could not load ${COMMITLINT_CONFIG_FILE}: the loader returned invalid output`);
  }
  const value = result as { ok?: unknown; error?: unknown; data?: { rules?: unknown; baseScopes?: unknown } };
  if (value.ok !== true) {
    const reason = typeof value.error === "string" && value.error ? value.error : "unknown error";
    throw new Error(`Could not load ${COMMITLINT_CONFIG_FILE}: ${reason}`);
  }
  const rules = value.data && typeof value.data.rules === "object" && value.data.rules !== null ? (value.data.rules as Record<string, unknown>) : {};
  return { rules, baseScopes: value.data ? value.data.baseScopes : undefined };
}
