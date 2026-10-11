// Tests for the developer capability probe runner against a fake fetch and a
// fake model list. No real API is called.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { requestsPerModel, wireFormatFor } from "../src/dev/probe/probeCases";
import { planCapabilityProbe, runCapabilityProbe } from "../src/dev/probe/runProbe";

const KEY = "probe-secret-key-123";
const noSleep = async (): Promise<void> => {};
const openAiCost = requestsPerModel({ providerName: "openai", wireFormat: wireFormatFor("openai") });

describe("probe runner", () => {
  it("plans without sending requests and reports model list failures", async () => {
    const plan = await planCapabilityProbe(
      [
        { providerName: "openai", apiKey: KEY },
        { providerName: "mistral", apiKey: KEY },
      ],
      async (input) => {
        if (input.providerName === "mistral") {
          throw new Error("401 bad key");
        }
        return ["gpt-a", "gpt-b"];
      },
    );

    assert.equal(plan.totalRequests, 2 * openAiCost);
    assert.equal(plan.providers[1].modelListError, "401 bad key");
  });

  it("finds the accepted cap field and reuses it for every feature case", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], async () => ["gpt-x"]);
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      bodies.push(body);
      if ("max_tokens" in body) {
        return new Response('{"error":{"message":"Unsupported parameter: max_tokens"}}', { status: 400 });
      }
      return new Response('{"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}', { status: 200 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(report.models[0].capField, "max_completion_tokens");
    assert.equal(bodies.length, plan.totalRequests);
    assert.ok(bodies.slice(2).every((body) => "max_completion_tokens" in body && !("max_tokens" in body)));
    assert.equal(JSON.stringify(report).includes(KEY), false);
  });

  it("retries a rate-limited request and then records the result", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], async () => ["claude-x"]);
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return calls === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "1" } }) : new Response('{"content":[]}', { status: 200 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(report.models[0].outcomes[0].status, "accepted");
    assert.equal(calls, plan.totalRequests + 1);
  });

  it("records a network failure as an outcome instead of throwing", async () => {
    const plan = await planCapabilityProbe([{ providerName: "cohere", apiKey: KEY }], async () => ["command-x"]);
    const fakeFetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.ok(report.models[0].outcomes.every((outcome) => outcome.status === "network_error" && outcome.error === "ECONNRESET"));
    assert.equal(report.models[0].capField, null);
  });

  it("reports progress up to the planned total", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], async () => ["gpt-x"]);
    const seen: number[] = [];
    const fakeFetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

    await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: (progress) => seen.push(progress.done), fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(seen.length, plan.totalRequests);
    assert.equal(seen[seen.length - 1], plan.totalRequests);
  });

  it("stops sending requests once cancelled", async () => {
    const plan = await planCapabilityProbe([{ providerName: "openai", apiKey: KEY }], async () => ["gpt-a", "gpt-b"]);
    const controller = new AbortController();
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      controller.abort();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: controller.signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(calls, 1);
    assert.equal(report.models.length, 1);
  });
});
