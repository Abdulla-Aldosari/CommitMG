import * as path from "path";
import * as vscode from "vscode";
import { buildPromptForRepo, CommitMessageObserver, CommitStyle, formatPromptPreview, generateCommitMessage, GenerationCancelledError, type GenerationStage } from "./generation";
import { extractAiErrorMessage } from "./ai/extractAiErrorMessage";
import { buildConfiguredAiClient, readButtonStyle, readRunSettings, readRunSnapshot } from "./settings/settingsStore";
import { SettingsPanel } from "./settings/settingsPanel";
import { developerDiagnosticsEnabled, DevSessionRecorder } from "./dev/devSessionRecorder";
import { PROBE_COMMAND_ID, runProbeCommand } from "./dev/probe/probeCommand";
import { initializeCapabilityStore } from "./ai/params/profileRules";

// Minimal structural types for the built-in Git extension API (vscode.git).
// See: extensions/git/src/api/git.d.ts in the VS Code repository.

interface GitInputBox {
  value: string;
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: GitInputBox;
}

interface GitAPI {
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

function resolveRepository(api: GitAPI, sourceControl: unknown): GitRepository | undefined {
  // When invoked from the `scm/title` menu, VS Code passes the clicked SourceControl.
  const rootUri = (sourceControl as { rootUri?: vscode.Uri } | undefined)?.rootUri;
  if (rootUri) {
    const repository = api.getRepository(rootUri);
    if (repository) {
      return repository;
    }
  }
  return api.repositories[0];
}

// The style picker shown by the scm/title button. A programmatic QuickPick
// is used instead of a contributed submenu because VS Code does not render
// the `icon` of submenu entries in the Source Control title bar. The 5th
// entry opens CommitMG Settings instead of a style, so the AI provider can
// be configured without leaving the picker flow.
const COMMIT_STYLE_PICKS: ReadonlyArray<{ label: string; description: string; style: CommitStyle }> = [
  { label: "Lengthy", description: "Detailed body", style: "lengthy" },
  { label: "Medium", description: "2–4 bullets", style: "medium" },
  { label: "Short", description: "One sentence", style: "short" },
  { label: "Title only", description: "Header only", style: "titleOnly" },
];

const OPEN_SETTINGS_LABEL = "$(gear) CommitMG Settings...";

async function pickCommitStyle(): Promise<CommitStyle | "openSettings" | undefined> {
  const selected = await vscode.window.showQuickPick(
    [...COMMIT_STYLE_PICKS.map(({ label, description }) => ({ label, description })), { label: OPEN_SETTINGS_LABEL, description: "Configure AI provider, model, and API key" }],
    { placeHolder: "Select a commit message style", ignoreFocusOut: true },
  );

  if (!selected) {
    return undefined;
  }
  if (selected.label === OPEN_SETTINGS_LABEL) {
    return "openSettings";
  }
  return COMMIT_STYLE_PICKS.find((pick) => pick.label === selected.label)?.style;
}

// Standalone developer tool: builds the prompts for the given repository and
// style and shows them in an untitled preview tab (markdown) without sending
// anything. Completely separate from the generation path, which always
// builds fresh prompts internally.
async function showPromptPreview(style: CommitStyle, repoRoot: string): Promise<void> {
  const prompts = await buildPromptForRepo(repoRoot, style, readRunSettings().options);

  const document = await vscode.workspace.openTextDocument({
    content: formatPromptPreview(style, prompts.systemPrompt, prompts.userPrompt),
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
}

function formatProblems(problems: readonly string[]): string {
  return problems.map((problem) => `  - ${problem}`).join("\n");
}

// Combines the UI notifications observer with the optional developer
// recorder so both see every lifecycle event of one generation run.
function mergeObservers(...observers: Array<CommitMessageObserver | undefined>): CommitMessageObserver | undefined {
  const active = observers.filter((observer): observer is CommitMessageObserver => observer !== undefined);
  if (active.length === 0) {
    return undefined;
  }
  if (active.length === 1) {
    return active[0];
  }
  return {
    onStage: (stage) => {
      for (const observer of active) observer.onStage?.(stage);
    },
    onPromptsBuilt: (prompts) => {
      for (const observer of active) observer.onPromptsBuilt?.(prompts);
    },
    onRequest: (attempt, request) => {
      for (const observer of active) observer.onRequest?.(attempt, request);
    },
    onReply: (attempt, reply) => {
      for (const observer of active) observer.onReply?.(attempt, reply);
    },
    onFirstAttempt: (message, violations) => {
      for (const observer of active) observer.onFirstAttempt?.(message, violations);
    },
    onCorrection: (message, violations) => {
      for (const observer of active) observer.onCorrection?.(message, violations);
    },
    onCompleted: (message) => {
      for (const observer of active) observer.onCompleted?.(message);
    },
  };
}

// Locates the repository a command should operate on (from the scm/title
// click or the first open repository) and warns the user when Git is
// unavailable. Returns undefined when no repository can be resolved.
async function resolveActiveRepository(sourceControl: unknown): Promise<GitRepository | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!gitExtension) {
    vscode.window.showWarningMessage("The built-in Git extension is not available.");
    return undefined;
  }

  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }

  if (!gitExtension.exports.enabled) {
    vscode.window.showWarningMessage("The built-in Git extension is disabled.");
    return undefined;
  }

  const api = gitExtension.exports.getAPI(1);
  const repository = resolveRepository(api, sourceControl);

  if (!repository) {
    vscode.window.showWarningMessage("No Git repository found.");
    return undefined;
  }

  return repository;
}

async function insertCommitMessage(context: vscode.ExtensionContext, style: CommitStyle, sourceControl?: unknown): Promise<void> {
  const repository = await resolveActiveRepository(sourceControl);
  if (!repository) {
    return;
  }

  const repoRoot = repository.rootUri.fsPath;
  const runSettings = readRunSettings();
  const recorder = developerDiagnosticsEnabled() ? new DevSessionRecorder(context, repoRoot, style, readRunSnapshot(runSettings)) : undefined;

  const observer = mergeObservers(
    {
      onFirstAttempt: (_message, violations) => {
        if (violations.length === 0) {
          return;
        }
        const next = runSettings.autoCorrect ? "Regenerating once with corrections..." : "Automatic correction is off - review before committing.";
        vscode.window.showWarningMessage(`Commit MG: Generated message violates ${violations.length} rule(s):\n${formatProblems(violations)}\n${next}`);
      },
      onCorrection: (_message, remainingViolations) => {
        if (remainingViolations.length === 0) {
          vscode.window.showInformationMessage("Commit MG: Corrected message now passes all checks.");
        } else {
          vscode.window.showWarningMessage(
            `Commit MG: Corrected message still violates ${remainingViolations.length} rule(s) - review before committing:\n${formatProblems(remainingViolations)}`,
          );
        }
      },
    },
    recorder?.observer(),
  );

  try {
    const aiClient = await buildConfiguredAiClient(context);

    const message = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Commit MG",
        cancellable: true,
      },
      (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        const withStages = mergeObservers(observer, { onStage: (stage) => progress.report({ message: STAGE_MESSAGES[stage] }) });
        return generateCommitMessage(repoRoot, style, aiClient, withStages, { signal: controller.signal, ...runSettings });
      },
    );

    repository.inputBox.value = message;
  } catch (error) {
    // Cancelling is a user choice, not a failure: nothing is inserted and
    // nothing is reported.
    if (error instanceof GenerationCancelledError) {
      recorder?.cancelled();
      return;
    }
    recorder?.error(error);
    vscode.window.showErrorMessage(`Commit MG: ${extractAiErrorMessage(error)}`);
  }
}

// Progress text shown in the notification for each generation stage.
const STAGE_MESSAGES: Readonly<Record<GenerationStage, string>> = {
  collecting: "Collecting changes...",
  requesting: "Waiting for the model...",
  validating: "Validating the message...",
  correcting: "Asking the model to fix rule violations...",
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("Commit MG extension activated.");

  // During extension development the capability store reads the source
  // capabilities.json, so capabilities merged by the Developer tab apply
  // without a rebuild. Packaged builds keep the bundled baseline.
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    initializeCapabilityStore(path.join(context.extensionUri.fsPath, "src", "ai", "params", "capabilities.json"));
  }

  // Shows the style picker, then generates with the chosen style.
  // Cancelling does nothing; the last entry opens CommitMG Settings.
  const pickAndGenerate = async (sourceControl?: unknown): Promise<void> => {
    const style = await pickCommitStyle();
    if (!style) {
      return;
    }
    if (style === "openSettings") {
      SettingsPanel.createOrShow(context);
      return;
    }
    await insertCommitMessage(context, style, sourceControl);
  };

  // The scm/title button generates with the default detail level when the
  // user chose one, and shows the style picker when it is "Ask every time".
  // The same command works from the Command Palette.
  context.subscriptions.push(
    vscode.commands.registerCommand("commitmg.insertCommitMessage", async (sourceControl?: unknown) => {
      const style = readButtonStyle();
      if (style) {
        await insertCommitMessage(context, style, sourceControl);
      } else {
        await pickAndGenerate(sourceControl);
      }
    }),
  );

  // Always shows the style picker, so one message can use another style
  // than the default detail level.
  context.subscriptions.push(vscode.commands.registerCommand("commitmg.insertCommitMessageWithStyle", pickAndGenerate));

  context.subscriptions.push(
    vscode.commands.registerCommand("commitmg.openSettings", () => {
      SettingsPanel.createOrShow(context);
    }),
  );

  // Developer tool: probes which request parameters each provider model
  // accepts. Gated by commitmg.developer.enabled inside the command.
  context.subscriptions.push(vscode.commands.registerCommand(PROBE_COMMAND_ID, () => runProbeCommand(context)));

  // Developer tool: builds and shows the exact prompts without sending them.
  context.subscriptions.push(
    vscode.commands.registerCommand("commitmg.previewPrompt", async (sourceControl?: unknown) => {
      const style = await pickCommitStyle();
      if (!style || style === "openSettings") {
        return;
      }

      const repository = await resolveActiveRepository(sourceControl);
      if (!repository) {
        return;
      }

      try {
        await showPromptPreview(style, repository.rootUri.fsPath);
      } catch (error) {
        vscode.window.showErrorMessage(`Commit MG: ${extractAiErrorMessage(error)}`);
      }
    }),
  );
}

export function deactivate(): void {}
