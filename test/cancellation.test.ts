// Tests that every AiClient forwards the abort signal of complete() to its
// transport, so cancelling a generation stops the in-flight request.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "mocha";
import type { AiClient } from "../src/ai/aiClient";
import { AnthropicClient } from "../src/ai/providers/anthropic";
import { CohereClient } from "../src/ai/providers/cohere";
import { GeminiClient } from "../src/ai/providers/gemini";
import { MistralClient } from "../src/ai/providers/mistral";
import { OpenAiCompatibleClient } from "../src/ai/providers/openaiCompatible";
import { VsCodeLmClient, type LmMessage, type VsCodeLmAccessor } from "../src/ai/vsCodeLmClient";

describe("complete() forwards the abort signal", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const clients: Array<[string, () => AiClient]> = [
    ["gemini", () => new GeminiClient("key", "gemini-x")],
    ["anthropic", () => new AnthropicClient("key", "claude-x")],
    ["mistral", () => new MistralClient("key", "mistral-x")],
    ["cohere", () => new CohereClient("key", "command-x")],
    ["openai-compatible", () => new OpenAiCompatibleClient("key", "gpt-x", "https://api.example.com/v1", "openai")],
  ];

  for (const [name, create] of clients) {
    it(`${name} passes the signal to fetch and rejects when it is aborted`, async () => {
      let receivedSignal: AbortSignal | null | undefined;
      globalThis.fetch = ((_url: string, init?: RequestInit) => {
        receivedSignal = init?.signal;
        // Behaves like fetch: rejects with an AbortError once the signal fires.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        });
      }) as typeof fetch;

      const controller = new AbortController();
      const pending = create().complete("system", "user", { signal: controller.signal });
      controller.abort();

      await assert.rejects(pending, { name: "AbortError" });
      assert.equal(receivedSignal, controller.signal);
    });
  }

  it("vscode passes the signal to the language model accessor", async () => {
    let receivedSignal: AbortSignal | undefined;
    const accessor: VsCodeLmAccessor = {
      selectModels: async () => [{ id: "copilot-x", name: "Copilot", vendor: "copilot", family: "x" }],
      sendRequest: async (_modelId: string, _messages: readonly LmMessage[], signal?: AbortSignal) => {
        receivedSignal = signal;
        return "fix(a): b";
      },
    };
    const controller = new AbortController();

    await new VsCodeLmClient(accessor, "copilot-x").complete("system", "user", { signal: controller.signal });

    assert.equal(receivedSignal, controller.signal);
  });
});
