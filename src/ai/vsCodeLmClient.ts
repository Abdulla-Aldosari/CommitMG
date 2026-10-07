// AiClient implementation for the "vscode" pathway: talks to whatever model
// the user configured in GitHub Copilot Chat via vscode.lm. This file stays
// vscode-free itself - it depends only on the small VsCodeLmAccessor
// interface below, whose real implementation (the only place that imports
// `vscode` for this pathway) lives in src/settings/vsCodeLmAccessorImpl.ts
// and is constructed/injected from src/extension.ts.

import type { AiClient, ModelListEntry } from "./aiClient";

// One chat message in the shape vscode.lm expects. Kept here (instead of
// importing vscode.LanguageModelChatMessage) so this file has zero vscode
// dependency; the real implementation converts this into the actual
// vscode.LanguageModelChatMessage.User(...) call.
export interface LmMessage {
  role: "user";
  content: string;
}

export interface LmModelDescriptor {
  id: string;
  name: string;
  vendor: string;
  family: string;
}

// Abstracts vscode.lm.selectChatModels() + model.sendRequest() behind an
// interface with no vscode import, so VsCodeLmClient (and anything that
// constructs it) can be unit-tested with a fake.
export interface VsCodeLmAccessor {
  // Returns every model currently available through Copilot Chat (including
  // BYOK models such as a local Ollama model added via "Chat: Manage
  // Language Models"), or an empty array when none are available/authorized.
  selectModels(): Promise<LmModelDescriptor[]>;

  // Sends messages to a specific model (by id, as returned by
  // selectModels()) and returns the concatenated response text. Throws a
  // plain Error with a user-facing message on failure (e.g. the user denied
  // consent, or no model matched the given id).
  sendRequest(modelId: string, messages: readonly LmMessage[]): Promise<string>;
}

export class VsCodeLmClient implements AiClient {
  readonly providerName = "vscode" as const;

  constructor(
    private readonly accessor: VsCodeLmAccessor,
    private readonly modelId?: string,
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    // The Language Model API does not support a separate system message
    // (see VS Code's Language Model API guide), so the two prompts are
    // merged into a single user message.
    const combined = `${systemPrompt}\n\n${userPrompt}`;

    const modelId = this.modelId || (await this.resolveDefaultModelId());
    if (!modelId) {
      throw new Error("No VS Code language model is available. Configure one in GitHub Copilot Chat (Manage Language Models).");
    }

    return this.accessor.sendRequest(modelId, [{ role: "user", content: combined }]);
  }

  async listModels(): Promise<ModelListEntry[]> {
    const models = await this.accessor.selectModels();
    return models.map((m) => ({ modelId: m.id, modelLabel: `${m.name} (${m.vendor})` }));
  }

  async checkConnection(): Promise<void> {
    const modelId = this.modelId || (await this.resolveDefaultModelId());
    if (!modelId) {
      throw new Error("No VS Code language model is available. Configure one in GitHub Copilot Chat (Manage Language Models).");
    }
    await this.accessor.sendRequest(modelId, [{ role: "user", content: "Hi" }]);
  }

  private async resolveDefaultModelId(): Promise<string | undefined> {
    const models = await this.accessor.selectModels();
    return models[0]?.id;
  }
}
