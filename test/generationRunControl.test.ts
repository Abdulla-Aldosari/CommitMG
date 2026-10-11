// Tests for cancelling a generation run, the per-request timeout, and the
// progress stages, against a real temporary git repository and fake clients.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import type { AiClient, CompletionOptions } from "../src/ai/aiClient";
import { generateCommitMessage, GenerationCancelledError, REQUEST_TIMEOUT_MS, type GenerationStage } from "../src/generation";

// Never answers; records the signal it was given.
class HangingClient implements AiClient {
  readonly providerName = "custom" as const;
  signals: Array<AbortSignal | undefined> = [];
  ignoreSignal = false;

  complete(_systemPrompt: string, _userPrompt: string, options?: CompletionOptions): Promise<string> {
    this.signals.push(options?.signal);
    return new Promise((_resolve, reject) => {
      if (!this.ignoreSignal) {
        options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      }
    });
  }

  async checkConnection(): Promise<void> {}
}

// Answers with fixed responses in order.
class ScriptedClient implements AiClient {
  readonly providerName = "custom" as const;
  constructor(private readonly responses: string[]) {}
  async complete(): Promise<string> {
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("no more responses");
    }
    return next;
  }
  async checkConnection(): Promise<void> {}
}

describe("generation run control", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commitmg-runctl-"));
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
    };
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "initial\n", "utf8");
    git("add", "a.txt");
    git("commit", "-q", "-m", "chore: initial commit");
    fs.writeFileSync(path.join(repoRoot, "a.txt"), "changed\n", "utf8");
    git("add", "a.txt");
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("uses a 120 second request timeout by default", () => {
    assert.equal(REQUEST_TIMEOUT_MS, 120000);
  });

  it("rejects with GenerationCancelledError when cancelled while waiting for the model", async () => {
    const client = new HangingClient();
    const controller = new AbortController();

    const pending = generateCommitMessage(
      repoRoot,
      "titleOnly",
      client,
      { onStage: (stage) => stage === "requesting" && setImmediate(() => controller.abort()) },
      { signal: controller.signal },
    );

    await assert.rejects(pending, GenerationCancelledError);
    assert.equal(client.signals[0]?.aborted, true);
  });

  it("stops a client that ignores the abort signal", async () => {
    const client = new HangingClient();
    client.ignoreSignal = true;
    const controller = new AbortController();

    const pending = generateCommitMessage(
      repoRoot,
      "titleOnly",
      client,
      { onStage: (stage) => stage === "requesting" && setImmediate(() => controller.abort()) },
      { signal: controller.signal },
    );

    await assert.rejects(pending, GenerationCancelledError);
  });

  it("never contacts the model when cancelled before the run starts", async () => {
    const client = new HangingClient();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(generateCommitMessage(repoRoot, "titleOnly", client, undefined, { signal: controller.signal }), GenerationCancelledError);
    assert.equal(client.signals.length, 0);
  });

  it("aborts a hung request with a clear timeout error", async () => {
    const client = new HangingClient();

    await assert.rejects(generateCommitMessage(repoRoot, "titleOnly", client, undefined, { requestTimeoutMs: 50 }), /did not answer within 0\.05 seconds/);
    assert.equal(client.signals[0]?.aborted, true);
  });

  it("forwards the model params to the client with every request", async () => {
    const received: CompletionOptions[] = [];
    const client: AiClient = {
      providerName: "custom",
      async complete(_system: string, _user: string, options?: CompletionOptions) {
        received.push(options ?? {});
        return received.length === 1 ? "bad header that is definitely far too long to pass the limit check" : "fix(a): shorten the header";
      },
      async checkConnection() {},
    };

    await generateCommitMessage(repoRoot, "titleOnly", client, undefined, { params: { reasoning: "low", maxOutputTokens: 1000 } });

    assert.equal(received.length, 2);
    for (const options of received) {
      assert.deepEqual(options.params, { reasoning: "low", maxOutputTokens: 1000 });
    }
  });

  it("reports every stage in order, including the correction", async () => {
    const stages: GenerationStage[] = [];
    const client = new ScriptedClient(["bad header that is definitely far too long to pass the limit check", "fix(a): shorten the header"]);

    const message = await generateCommitMessage(repoRoot, "titleOnly", client, { onStage: (stage) => stages.push(stage) });

    assert.equal(message, "fix(a): shorten the header");
    assert.deepEqual(stages, ["collecting", "requesting", "validating", "correcting"]);
  });
});
