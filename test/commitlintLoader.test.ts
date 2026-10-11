// Tests for the isolated commitlint config loader. The config runs in a child
// Node process, so these tests exercise the real subprocess path: module
// formats, failures, timeouts, stdout noise, and isolation from the host.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import { COMMITLINT_CONFIG_FILE, COMMITLINT_LOAD_TIMEOUT_MS, loadCommitlintConfig, parseLoaderResult } from "../src/generation";

const RULES = '{ rules: { "scope-enum": [2, "always", ["a", "b"]], "header-max-length": [2, "always", 72] }, baseScopes: [["a", "first", ["src/a/"]]] }';
const EXPECTED_RULES = { "scope-enum": [2, "always", ["a", "b"]], "header-max-length": [2, "always", 72] };

describe("loadCommitlintConfig (isolated process)", () => {
  let repoRoot: string;

  const writeConfig = (text: string): void => {
    fs.writeFileSync(path.join(repoRoot, COMMITLINT_CONFIG_FILE), text, "utf8");
  };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-loader-"));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns null when the repository has no config", async () => {
    assert.equal(await loadCommitlintConfig(repoRoot), null);
  });

  it("loads a CommonJS config and returns only rules, baseScopes, and the raw text", async () => {
    const text = `module.exports = ${RULES};\n`;
    writeConfig(text);

    const loaded = await loadCommitlintConfig(repoRoot);

    assert.deepEqual(loaded, { data: { rules: EXPECTED_RULES, baseScopes: [["a", "first", ["src/a/"]]] }, text });
  });

  it("loads an ES module config in a package with type module", async () => {
    fs.writeFileSync(path.join(repoRoot, "package.json"), '{ "type": "module" }\n', "utf8");
    writeConfig(`export default ${RULES};\n`);

    const loaded = await loadCommitlintConfig(repoRoot);

    assert.deepEqual(loaded?.data.rules, EXPECTED_RULES);
  });

  it("ignores anything the config prints to stdout", async () => {
    writeConfig(`console.log("noise before"); process.stdout.write("{ not json"); module.exports = ${RULES};\n`);

    const loaded = await loadCommitlintConfig(repoRoot);

    assert.deepEqual(loaded?.data.rules, EXPECTED_RULES);
  });

  it("reports a config that throws, with its own message", async () => {
    writeConfig('throw new Error("config exploded");\n');

    await assert.rejects(loadCommitlintConfig(repoRoot), /Could not load commitlint\.config\.js: config exploded/);
  });

  it("does not run the config inside the host process", async () => {
    writeConfig(`globalThis.__commitmgConfigRan = true; module.exports = ${RULES};\n`);

    await loadCommitlintConfig(repoRoot);

    assert.equal((globalThis as { __commitmgConfigRan?: boolean }).__commitmgConfigRan, undefined);
  });

  it("passes the config path as data, never as code", async () => {
    // Characters that would break or inject code if the path were spliced into
    // the loader script, limited to ones that are valid on every platform.
    const nested = path.join(repoRoot, `dir 'q' \`t\` \${x} $(x) %COMSPEC%`);
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, COMMITLINT_CONFIG_FILE), `module.exports = ${RULES};\n`, "utf8");

    const loaded = await loadCommitlintConfig(nested);

    assert.deepEqual(loaded?.data.rules, EXPECTED_RULES);
  });

  it("stops a config that never finishes", async () => {
    writeConfig("while (true) {}\n");

    await assert.rejects(loadCommitlintConfig(repoRoot, 1000), /did not finish within 1 seconds/);
  });

  it("uses a ten second timeout by default", () => {
    assert.equal(COMMITLINT_LOAD_TIMEOUT_MS, 10000);
  });
});

describe("parseLoaderResult", () => {
  it("normalizes a missing rules object to an empty one", () => {
    assert.deepEqual(parseLoaderResult('{"ok":true,"data":{}}'), { rules: {}, baseScopes: undefined });
  });

  it("rejects output that is not JSON", () => {
    assert.throws(() => parseLoaderResult("garbage"), /the loader returned invalid output/);
  });

  it("rejects a failure result with its reason", () => {
    assert.throws(() => parseLoaderResult('{"ok":false,"error":"boom"}'), /Could not load commitlint\.config\.js: boom/);
  });
});
