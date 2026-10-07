// The only file that bridges src/ai/vsCodeLmClient.ts's vscode-free
// VsCodeLmAccessor interface to the real vscode.lm API. Constructed once in
// extension.ts and passed down to createAiClient() whenever the user's
// selected pathway is "vscode".

import * as vscode from "vscode";
import type { LmMessage, LmModelDescriptor, VsCodeLmAccessor } from "../ai/vsCodeLmClient";

export class VsCodeLmAccessorImpl implements VsCodeLmAccessor {
  async selectModels(): Promise<LmModelDescriptor[]> {
    const models = await vscode.lm.selectChatModels();
    return models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, family: m.family }));
  }

  async sendRequest(modelId: string, messages: readonly LmMessage[]): Promise<string> {
    const models = await vscode.lm.selectChatModels({ id: modelId });
    const model = models[0];
    if (!model) {
      throw new Error(`No VS Code language model matches id "${modelId}". It may have been removed; reselect a model in CommitMG Settings.`);
    }

    const chatMessages = messages.map((message) => vscode.LanguageModelChatMessage.User(message.content));

    try {
      const response = await model.sendRequest(chatMessages, {}, new vscode.CancellationTokenSource().token);
      let text = "";
      for await (const fragment of response.text) {
        text += fragment;
      }
      return text.trim();
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        throw new Error(`VS Code Language Model error (${err.code}): ${err.message}`, { cause: err });
      }
      throw err;
    }
  }
}
