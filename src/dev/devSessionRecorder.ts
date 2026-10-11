// Developer diagnostics recorder. Captures one generation session per run
// under the extension global storage and logs every created file path to the
// "Commit MG Developer" output channel. Strictly opt-in: extension.ts only
// constructs it when the commitmg.developer.enabled setting is on, and the
// core generation path never imports this module.
//
// Files of one session folder:
//   meta.json                  what the run was configured with, the prompt
//                              sizes, each attempt's outcome (finish reason,
//                              cut off, violations), and how the run ended
//   prompt-system.md, prompt-user.md   the exact prompts
//   request-<n>.json           the exact body sent for attempt n (direct
//                              providers only)
//   reply-<n>.json             the provider's parsed reply to attempt n,
//                              written even when the reply is rejected
//   attempt-<n>.md, attempt-<n>-violations.txt   the message and its problems
//   final.md, error.log        the result, or the error with its causes

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { CompletionReply } from "../ai/aiClient";
import { countPromptTokens } from "../ai/estimatePromptCost";
import type { CommitMessageObserver, GenerationAttempt } from "../generation";
import type { RunSnapshot } from "../settings/settingsStore";

let devChannel: vscode.OutputChannel | undefined;

function getDevChannel(): vscode.OutputChannel {
  if (!devChannel) {
    devChannel = vscode.window.createOutputChannel("Commit MG Developer");
  }
  return devChannel;
}

export function developerDiagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration("commitmg").get<boolean>("developer.enabled", false);
}

const ATTEMPT_NUMBERS: Readonly<Record<GenerationAttempt, number>> = { first: 1, correction: 2 };

interface PromptSize {
  chars: number;
  tokens: number;
}

// What happened to one request, as far as it got.
interface AttemptRecord {
  attempt: number;
  modelId?: string;
  finishReason?: string;
  cutOff?: boolean;
  violations?: readonly string[];
}

type SessionOutcome = "running" | "completed" | "failed" | "cancelled";

// The error message and every cause under it, so a timeout or a wrapped
// provider error shows its original reason too.
export function describeError(error: unknown): string {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const prefix = depth === 0 ? "" : "Caused by: ";
    lines.push(current instanceof Error ? `${prefix}${current.name}: ${current.message}\n${current.stack ?? ""}` : `${prefix}${String(current)}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines.join("\n\n");
}

// Records one generateCommitMessage() run: the settings it ran with, the
// exact prompts and their size, each request body and provider reply, each
// attempt's message and violations, and the final message or the error.
// meta.json is rewritten after every step, so a run that hangs or crashes
// still leaves an up-to-date summary. Writes one timestamped folder per
// session so consecutive runs never overwrite each other.
export class DevSessionRecorder {
  private readonly sessionDir: string;
  private readonly startedAt = Date.now();
  private prompts: { system: PromptSize; user: PromptSize; total: PromptSize } | undefined;
  private readonly attempts: AttemptRecord[] = [];
  private outcome: SessionOutcome = "running";
  private errorMessage: string | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly repoRoot: string,
    private readonly style: string,
    private readonly settings: RunSnapshot,
  ) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.sessionDir = path.join(context.globalStorageUri.fsPath, "dev-sessions", stamp);
    fs.mkdirSync(this.sessionDir, { recursive: true });
    getDevChannel().appendLine(`Session started: ${this.sessionDir}`);
    this.writeMeta();
  }

  observer(): CommitMessageObserver {
    return {
      onPromptsBuilt: (prompts) => {
        this.writeFile("prompt-system.md", prompts.systemPrompt);
        this.writeFile("prompt-user.md", prompts.userPrompt);
        const system = sizeOf(prompts.systemPrompt);
        const user = sizeOf(prompts.userPrompt);
        this.prompts = { system, user, total: { chars: system.chars + user.chars, tokens: system.tokens + user.tokens } };
        this.writeMeta();
      },
      onRequest: (attempt, request) => {
        const record = this.attemptRecord(attempt);
        record.modelId = request.modelId;
        this.writeJson(`request-${record.attempt}.json`, request.body);
        this.writeMeta();
      },
      onReply: (attempt, reply) => this.recordReply(attempt, reply),
      onFirstAttempt: (message, violations) => this.recordMessage("first", message, violations),
      onCorrection: (message, violations) => this.recordMessage("correction", message, violations),
      onCompleted: (message) => {
        this.writeFile("final.md", message);
        this.outcome = "completed";
        this.writeMeta();
        getDevChannel().appendLine(`Session complete: ${this.sessionDir}`);
      },
    };
  }

  // Called by the extension when the generation call throws. The error and
  // its causes are recorded alongside the session and the channel is
  // brought to front so the developer sees the failure immediately.
  error(error: unknown): void {
    this.outcome = "failed";
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.writeFile("error.log", describeError(error));
    this.writeMeta();
    getDevChannel().appendLine(`Session failed: ${this.sessionDir}`);
    getDevChannel().show(true);
  }

  // Called by the extension when the user cancels the run.
  cancelled(): void {
    this.outcome = "cancelled";
    this.writeMeta();
    getDevChannel().appendLine(`Session cancelled: ${this.sessionDir}`);
  }

  private recordReply(attempt: GenerationAttempt, reply: CompletionReply): void {
    const record = this.attemptRecord(attempt);
    record.finishReason = reply.finishReason;
    record.cutOff = reply.cutOff;
    this.writeJson(`reply-${record.attempt}.json`, reply.body);
    this.writeMeta();
  }

  private recordMessage(attempt: GenerationAttempt, message: string, violations: readonly string[]): void {
    const record = this.attemptRecord(attempt);
    record.violations = violations;
    this.writeFile(`attempt-${record.attempt}.md`, message);
    if (violations.length > 0) {
      this.writeFile(`attempt-${record.attempt}-violations.txt`, violations.join("\n"));
    }
    this.writeMeta();
  }

  private attemptRecord(attempt: GenerationAttempt): AttemptRecord {
    const number = ATTEMPT_NUMBERS[attempt];
    let record = this.attempts.find((candidate) => candidate.attempt === number);
    if (!record) {
      record = { attempt: number };
      this.attempts.push(record);
    }
    return record;
  }

  private writeJson(name: string, value: unknown): void {
    this.writeFile(name, JSON.stringify(value, null, 2));
  }

  private writeFile(name: string, content: string): void {
    const filePath = path.join(this.sessionDir, name);
    fs.writeFileSync(filePath, content, "utf8");
    getDevChannel().appendLine(`Wrote: ${filePath}`);
  }

  private writeMeta(): void {
    this.writeJson("meta.json", {
      repoRoot: this.repoRoot,
      style: this.style,
      startedAt: new Date(this.startedAt).toISOString(),
      durationMs: Date.now() - this.startedAt,
      outcome: this.outcome,
      error: this.errorMessage,
      prompt: this.prompts,
      attempts: this.attempts,
      settings: this.settings,
    });
  }
}

function sizeOf(text: string): PromptSize {
  return { chars: text.length, tokens: countPromptTokens(text) };
}
