// Tests for the developer capability probe runner against a fake fetch and a
// fake model list. No real API is called.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { requestsPerModel, wireFormatFor } from "../src/dev/probe/probeCases";
import { planCapabilityProbe, RATE_LIMIT_RETRIES, runCapabilityProbe } from "../src/dev/probe/runProbe";

const KEY = "probe-secret-key-123";
const noSleep = async (): Promise<void> => {};
const openAiCost = requestsPerModel({ providerName: "openai", wireFormat: wireFormatFor("openai") });
const ok = (): Response => new Response('{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}', { status: 200 });

describe("probe runner", () => {
  it("plans without sending requests and reports model list failures", async () => {
    const plan = await planCapabilityProbe(
      [
        { providerName: "openai", apiKey: KEY },
        { providerName: "mistral", apiKey: KEY },
      ],
      new Map(),
      async (input) => {
        if (input.providerName === "mistral") {
          throw new Error("401 bad key");
        }
        return ["gpt-a", "gpt-b"];
      },
    );

    assert.equal(plan.totalRequests, 2 * openAiCost);
    assert.equal(plan.skippedCases, 0);
    assert.equal(plan.providers[1].modelListError, "401 bad key");
  });

  it("finds the accepted cap field and reuses it for every feature case", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], new Map(), async () => ["gpt-x"]);
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      bodies.push(body);
      if ("max_tokens" in body) {
        return new Response('{"error":{"message":"Unsupported parameter: max_tokens"}}', { status: 400 });
      }
      return ok();
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(report.models[0].capField, "max_completion_tokens");
    assert.equal(bodies.length, plan.totalRequests);
    assert.ok(bodies.slice(2).every((body) => "max_completion_tokens" in body && !("max_tokens" in body)));
    assert.equal(JSON.stringify(report).includes(KEY), false);
  });

  it("retries a rate-limited request after a short wait and keeps going when the retry succeeds", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], new Map(), async () => ["claude-x"]);
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return calls === 1 ? new Response("busy", { status: 429, headers: { "Retry-After": "3" } }) : new Response('{"content":[]}', { status: 200 });
    }) as typeof fetch;
    const waits: number[] = [];
    const progressWaits: number[] = [];

    const [report] = await runCapabilityProbe(plan, {
      signal: new AbortController().signal,
      onProgress: (progress) => progress.waitingMs !== undefined && progressWaits.push(progress.waitingMs),
      fetchImpl: fakeFetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    assert.equal(calls, plan.totalRequests + 1, "one extra request for the retry");
    assert.ok(waits.includes(3000), "the Retry-After hint sets the wait");
    assert.deepEqual(progressWaits, [3000]);
    assert.equal(report.models[0].outcomes.length, plan.totalRequests);
    assert.ok(report.models[0].outcomes.every((outcome) => outcome.status === "accepted"));
  });

  it("skips the rest of a model when the retry is rate limited too and moves to the next model", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], new Map(), async () => ["claude-busy", "claude-free"]);
    const sentTo: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const model = (JSON.parse(init.body as string) as { model: string }).model;
      sentTo.push(model);
      return model === "claude-busy" ? new Response("busy", { status: 429 }) : new Response('{"content":[]}', { status: 200 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(sentTo.filter((model) => model === "claude-busy").length, 1 + RATE_LIMIT_RETRIES);
    assert.deepEqual(
      report.models[0].outcomes.map((outcome) => outcome.status),
      ["rate_limited"],
    );
    assert.ok(report.models[1].outcomes.length > 1 && report.models[1].outcomes.every((outcome) => outcome.status === "accepted"));
  });

  it("does not retry after the run is cancelled during the wait", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], new Map(), async () => ["claude-x"]);
    const controller = new AbortController();
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("busy", { status: 429 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, {
      signal: controller.signal,
      onProgress: () => {},
      fetchImpl: fakeFetch,
      sleep: async () => controller.abort(),
    });

    assert.equal(calls, 1);
    assert.deepEqual(
      report.models[0].outcomes.map((outcome) => outcome.status),
      ["rate_limited"],
    );
  });

  it("records a network failure as an outcome instead of throwing", async () => {
    const plan = await planCapabilityProbe([{ providerName: "cohere", apiKey: KEY }], new Map(), async () => ["command-x"]);
    const fakeFetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.ok(report.models[0].outcomes.every((outcome) => outcome.status === "network_error" && outcome.error === "ECONNRESET"));
    assert.equal(report.models[0].capField, null);
  });

  it("reports progress up to the planned total", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], new Map(), async () => ["gpt-x"]);
    const seen: number[] = [];
    const fakeFetch = (async () => ok()) as typeof fetch;

    await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: (progress) => seen.push(progress.done), fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(seen.length, plan.totalRequests);
    assert.equal(seen[seen.length - 1], plan.totalRequests);
  });

  it("stops sending requests once cancelled", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], new Map(), async () => ["gpt-a", "gpt-b"]);
    const controller = new AbortController();
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      controller.abort();
      return ok();
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: controller.signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(calls, 1);
    assert.equal(report.models.length, 2);
  });
});
