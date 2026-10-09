// Developer diagnostics recorder. Captures one generation session per run
// under the extension global storage and logs every created file path to the
// "Commit MG Developer" output channel. Strictly opt-in: extension.ts only
// constructs it when the commitmg.developer.enabled setting is on, and the
// core generation path never imports this module.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { CommitMessageObserver } from "../commitMessage";

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

// Records one generateCommitMessage() run: the exact prompts, the first
// attempt with its violations, the correction attempt when one happened, the
// final message, and any error the call threw. Writes one timestamped folder
// per session so consecutive runs never overwrite each other.
export class DevSessionRecorder {
  private readonly sessionDir: string;
  private readonly repoRoot: string;
  private readonly style: string;
  private readonly startedAt = Date.now();
  private errorOccurred = false;

  constructor(context: vscode.ExtensionContext, repoRoot: string, style: string) {
    this.repoRoot = repoRoot;
    this.style = style;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.sessionDir = path.join(context.globalStorageUri.fsPath, "dev-sessions", stamp);
    fs.mkdirSync(this.sessionDir, { recursive: true });
    getDevChannel().appendLine(`Session started: ${this.sessionDir}`);
  }

  observer(): CommitMessageObserver {
    return {
      onPromptsBuilt: (prompts) => {
        this.writeFile("prompt-system.md", prompts.systemPrompt);
        this.writeFile("prompt-user.md", prompts.userPrompt);
      },
      onFirstAttempt: (message, violations) => {
        this.writeFile("attempt-1.md", message);
        if (violations.length > 0) {
          this.writeFile("attempt-1-violations.txt", violations.join("\n"));
        }
      },
      onCorrection: (message, violations) => {
        this.writeFile("attempt-2.md", message);
        if (violations.length > 0) {
          this.writeFile("attempt-2-violations.txt", violations.join("\n"));
        }
      },
      onCompleted: (message) => {
        this.writeFile("final.md", message);
        this.writeMeta();
        getDevChannel().appendLine(`Session complete: ${this.sessionDir}`);
      },
    };
  }

  // Called by the extension when the generation call throws. The error is
  // recorded alongside the session and the channel is brought to front so
  // the developer sees the failure immediately.
  error(error: unknown): void {
    this.errorOccurred = true;
    const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    this.writeFile("error.log", text);
    this.writeMeta();
    getDevChannel().appendLine(`Session failed: ${this.sessionDir}`);
    getDevChannel().show(true);
  }

  private writeFile(name: string, content: string): void {
    const filePath = path.join(this.sessionDir, name);
    fs.writeFileSync(filePath, content, "utf8");
    getDevChannel().appendLine(`Wrote: ${filePath}`);
  }

  private writeMeta(): void {
    this.writeFile(
      "meta.json",
      JSON.stringify(
        {
          repoRoot: this.repoRoot,
          style: this.style,
          startedAt: new Date(this.startedAt).toISOString(),
          durationMs: Date.now() - this.startedAt,
          error: this.errorOccurred,
        },
        null,
        2,
      ),
    );
  }
}
