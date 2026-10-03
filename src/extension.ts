import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeKind, FileChange, generateCommitMessage } from './commitMessage';

// Minimal structural types for the built-in Git extension API (vscode.git).
// See: extensions/git/src/api/git.d.ts in the VS Code repository.
const enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED
}

interface GitChange {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: Status;
}

interface GitInputBox {
  value: string;
}

interface GitRepositoryState {
  readonly indexChanges: GitChange[];
  readonly workingTreeChanges: GitChange[];
  readonly untrackedChanges?: GitChange[];
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: GitInputBox;
  readonly state: GitRepositoryState;
}

interface GitAPI {
  readonly repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

function toChangeKind(status: Status): ChangeKind {
  switch (status) {
    case Status.INDEX_ADDED:
    case Status.INDEX_COPIED:
    case Status.UNTRACKED:
    case Status.INTENT_TO_ADD:
      return 'added';
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return 'deleted';
    case Status.INDEX_RENAMED:
    case Status.INTENT_TO_RENAME:
      return 'renamed';
    default:
      return 'modified';
  }
}

function toFileChanges(repository: GitRepository, changes: readonly GitChange[]): FileChange[] {
  return changes
    .filter((change) => change.status !== Status.IGNORED)
    .map((change) => ({
      path: path
        .relative(repository.rootUri.fsPath, (change.renameUri ?? change.uri).fsPath)
        .split(path.sep)
        .join('/'),
      kind: toChangeKind(change.status)
    }));
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Commit MG extension activated.');

  const disposable = vscode.commands.registerCommand(
    'commitmg.insertCommitMessage',
    async (sourceControl?: unknown) => {
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!gitExtension) {
        vscode.window.showWarningMessage('The built-in Git extension is not available.');
        return;
      }

      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      if (!gitExtension.exports.enabled) {
        vscode.window.showWarningMessage('The built-in Git extension is disabled.');
        return;
      }

      const api = gitExtension.exports.getAPI(1);
      const repository = resolveRepository(api, sourceControl);

      if (!repository) {
        vscode.window.showWarningMessage('No Git repository found.');
        return;
      }

      // Prefer staged changes (what will actually be committed); fall back to all changes.
      const { indexChanges, workingTreeChanges, untrackedChanges = [] } = repository.state;
      const sourceChanges =
        indexChanges.length > 0
          ? indexChanges
          : [...workingTreeChanges, ...untrackedChanges];

      const message = generateCommitMessage(toFileChanges(repository, sourceChanges));

      if (!message) {
        vscode.window.showInformationMessage('There are no changes to describe.');
        return;
      }

      repository.inputBox.value = message;
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}

