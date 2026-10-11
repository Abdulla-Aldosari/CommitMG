// Golden tests for the exact request body every provider client sends and
// for how each client reads the reply. A change here changes what reaches
// a provider, so every expected body is spelled out in full.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "mocha";
import type { AiClient } from "../src/ai/aiClient";
import { AnthropicClient } from "../src/ai/providers/anthropic";
import { CohereClient } from "../src/ai/providers/cohere";
import { GeminiClient } from "../src/ai/providers/gemini";
import { MistralClient } from "../src/ai/providers/mistral";
import { OpenAiCompatibleClient } from "../src/ai/providers/openaiCompatible";

const SYSTEM = "system rules";
const USER = "the diff";
const chat = [
  { role: "system", content: SYSTEM },
  { role: "user", content: USER },
];

describe("provider request bodies", () => {
  const originalFetch = globalThis.fetch;
  let sent: Array<{ url: string; body: unknown }>;
  let reply: unknown;

  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const bodyFor = async (client: AiClient, answer: unknown): Promise<unknown> => {
    reply = answer;
    await client.complete(SYSTEM, USER);
    assert.equal(sent.length, 1);
    return sent[0].body;
  };

  const openAiReply = { choices: [{ message: { content: "fix(a): b" }, finish_reason: "stop" }] };

  it("openai sends max_completion_tokens to every model", async () => {
    const body = await bodyFor(new OpenAiCompatibleClient("k", "gpt-4o-mini", "https://api.example.com/v1", "openai"), openAiReply);
    assert.deepEqual(body, { model: "gpt-4o-mini", messages: chat, temperature: 0.2, max_completion_tokens: 8192 });
  });

  it("openai drops the temperature for models that accept only the default", async () => {
    for (const modelId of ["gpt-5-mini", "gpt-5.5", "o3", "gpt-9-unknown"]) {
      sent = [];
      const body = await bodyFor(new OpenAiCompatibleClient("k", modelId, "https://api.example.com/v1", "openai"), openAiReply);
      assert.deepEqual(body, { model: modelId, messages: chat, max_completion_tokens: 8192 }, modelId);
    }
  });

  it("deepseek, groq, stepfun and custom servers keep the classic fields", async () => {
    for (const [provider, modelId] of [
      ["deepseek", "deepseek-flash"],
      ["groq", "openai/gpt-oss-20b"],
      ["stepfun", "step-3.5-flash"],
      ["custom", "llama3"],
    ] as const) {
      sent = [];
      const body = await bodyFor(new OpenAiCompatibleClient("k", modelId, "https://api.example.com/v1", provider), openAiReply);
      assert.deepEqual(body, { model: modelId, messages: chat, temperature: 0.2, max_tokens: 8192 }, provider);
    }
  });

  it("mistral", async () => {
    const body = await bodyFor(new MistralClient("k", "mistral-small-latest"), openAiReply);
    assert.deepEqual(body, { model: "mistral-small-latest", messages: chat, temperature: 0.2, max_tokens: 8192 });
  });

  it("anthropic", async () => {
    const body = await bodyFor(new AnthropicClient("k", "claude-sonnet-4-6"), { content: [{ type: "text", text: "fix(a): b" }] });
    assert.deepEqual(body, { model: "claude-sonnet-4-6", max_tokens: 8192, system: SYSTEM, messages: [{ role: "user", content: USER }] });
  });

  const geminiReply = { candidates: [{ content: { parts: [{ text: "fix(a): b" }] } }] };
  const geminiBody = (generationConfig: Record<string, unknown>) => ({
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: USER }] }],
    generationConfig,
  });

  it("gemini 2.5 keeps the temperature and caps thinking with a budget", async () => {
    const body = await bodyFor(new GeminiClient("k", "gemini-2.5-flash"), geminiReply);
    assert.deepEqual(body, geminiBody({ temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 4096 } }));
  });

  it("gemini 3 sends a thinking level instead of a budget and no temperature", async () => {
    const body = await bodyFor(new GeminiClient("k", "gemini-3.5-flash"), geminiReply);
    assert.deepEqual(body, geminiBody({ maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "medium" } }));
  });

  it("gemma and unknown Gemini models get no thinking config", async () => {
    assert.deepEqual(await bodyFor(new GeminiClient("k", "gemma-4-31b-it"), geminiReply), geminiBody({ temperature: 0.2, maxOutputTokens: 8192 }));
    sent = [];
    assert.deepEqual(await bodyFor(new GeminiClient("k", "gemini-9-unknown"), geminiReply), geminiBody({ maxOutputTokens: 8192 }));
  });

  it("cohere", async () => {
    const body = await bodyFor(new CohereClient("k", "command-a-03-2025"), { message: { content: [{ type: "text", text: "fix(a): b" }] } });
    assert.deepEqual(body, { model: "command-a-03-2025", messages: chat });
  });
});

describe("provider reply reading", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const answer = async (client: AiClient, reply: unknown): Promise<string> => {
    globalThis.fetch = (async () => new Response(JSON.stringify(reply), { status: 200 })) as typeof fetch;
    return client.complete(SYSTEM, USER);
  };

  it("joins Anthropic and Cohere text blocks and skips thinking blocks", async () => {
    const blocks = [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "fix(a): " },
      { type: "text", text: "b " },
    ];
    assert.equal(await answer(new AnthropicClient("k", "claude-x"), { content: blocks }), "fix(a): b");
    assert.equal(await answer(new CohereClient("k", "command-x"), { message: { content: blocks } }), "fix(a): b");
  });

  it("skips Gemini thought parts", async () => {
    const parts = [{ text: "hidden", thought: true }, { text: "fix(a): b" }];
    assert.equal(await answer(new GeminiClient("k", "gemini-x"), { candidates: [{ content: { parts } }] }), "fix(a): b");
  });

  it("never returns the separate reasoning fields of OpenAI-style replies", async () => {
    const reply = { choices: [{ message: { content: "fix(a): b", reasoning: "hidden", reasoning_content: "hidden" }, finish_reason: "stop" }] };
    assert.equal(await answer(new OpenAiCompatibleClient("k", "step-x", "https://api.example.com/v1", "stepfun"), reply), "fix(a): b");
  });

  it("names the provider and the finish reason when the reply has no answer", async () => {
    await assert.rejects(answer(new OpenAiCompatibleClient("k", "x", "https://api.example.com/v1", "groq"), { choices: [{ message: {}, finish_reason: "length" }] }), {
      message: "groq returned no usable content (finish_reason: length)",
    });
    await assert.rejects(answer(new AnthropicClient("k", "x"), { content: [], stop_reason: "refusal" }), {
      message: "Anthropic returned no usable content (stop_reason: refusal)",
    });
    await assert.rejects(answer(new GeminiClient("k", "x"), { promptFeedback: { blockReason: "SAFETY" } }), { message: "Gemini returned no usable content (blocked: SAFETY)" });
  });
});
