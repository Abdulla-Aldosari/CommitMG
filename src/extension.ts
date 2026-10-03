import * as vscode from 'vscode';

const COMMIT_MESSAGE = 'test(my-project) this is just an experiment';

// Minimal structural types for the built-in Git extension API (vscode.git).
// See: extensions/git/src/api/git.d.ts in the VS Code repository.
interface GitInputBox {
  value: string;
}

interface GitRepository {
  readonly inputBox: GitInputBox;
}

interface GitAPI {
  readonly repositories: GitRepository[];
}

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const disposable = vscode.commands.registerCommand(
    'testExperiment.insertCommitMessage',
    async () => {
      const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!gitExtension) {
        vscode.window.showWarningMessage('The built-in Git extension is not available.');
        return;
      }

      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      const api = gitExtension.exports.getAPI(1);
      const repository = api.repositories[0];

      if (!repository) {
        vscode.window.showWarningMessage('No Git repository found.');
        return;
      }

      repository.inputBox.value = COMMIT_MESSAGE;
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
