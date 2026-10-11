// Tests for resuming a capability probe from an earlier report: only
// unfinished cases are re-sent, only for models in the CURRENT filtered list,
// and the results merge back into one report.

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { featureProbeCases, wireFormatFor } from "../src/dev/probe/probeCases";
import type { ProbeOutcome } from "../src/dev/probe/probeResult";
import { indexReport, mergeReports, type ProbeReportFile } from "../src/dev/probe/resumeProbe";
import { planCapabilityProbe, runCapabilityProbe, type ProviderProbeReport } from "../src/dev/probe/runProbe";

const KEY = "probe-secret-key-123";
const noSleep = async (): Promise<void> => {};
const anthropicCases = featureProbeCases({ providerName: "anthropic", wireFormat: wireFormatFor("anthropic") }).map((probeCase) => probeCase.id);

const outcome = (caseId: string, status: ProbeOutcome["status"]): ProbeOutcome => ({ caseId, status, latencyMs: 1 });

function reportOf(providers: ProviderProbeReport[]): ProbeReportFile {
  return { generatedAt: "2026-10-11T00:00:00.000Z", durationMs: 1, cancelled: false, providers };
}

// claude-done: everything final. claude-half: baseline final, then a 429 on
// the first feature case. claude-hidden: unfinished, but the current filter
// no longer lists it.
const previous = reportOf([
  {
    providerName: "anthropic",
    wireFormat: "anthropic",
    models: [
      { modelId: "claude-done", capField: "max_tokens", outcomes: [outcome("baseline", "accepted"), ...anthropicCases.map((id) => outcome(id, "rejected"))] },
      { modelId: "claude-half", capField: "max_tokens", outcomes: [outcome("baseline", "accepted"), outcome(anthropicCases[0], "rate_limited")] },
      { modelId: "claude-hidden", capField: null, outcomes: [outcome("baseline", "rate_limited")] },
    ],
  },
  { providerName: "groq", wireFormat: "openai-chat", models: [{ modelId: "gpt-oss", capField: "max_tokens", outcomes: [outcome("baseline", "accepted")] }] },
]);

describe("probe resume", () => {
  it("plans only unfinished cases for models in the current filtered list", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], indexReport(previous), async () => ["claude-done", "claude-half", "claude-new"]);
    const [provider] = plan.providers;

    assert.deepEqual(
      provider.models.map((work) => work.modelId),
      ["claude-done", "claude-half", "claude-new"],
    );
    const [done, half, fresh] = provider.models;
    assert.equal(done.capCases.length + done.featureCases.length, 0);
    assert.equal(half.capCases.length, 0, "the cap field is already known");
    assert.equal(half.featureCases.length, anthropicCases.length, "the rate-limited case and every case after it are re-sent");
    assert.equal(fresh.capCases.length + fresh.featureCases.length, 1 + anthropicCases.length);
    assert.equal(plan.totalRequests, anthropicCases.length + 1 + anthropicCases.length);
    assert.equal(plan.skippedCases, 1 + anthropicCases.length + 1);
  });

  it("re-sends cases an older report stored as rejected for billing or output-limit reasons", async () => {
    const legacy = reportOf([
      {
        providerName: "anthropic",
        wireFormat: "anthropic",
        models: [
          {
            modelId: "claude-legacy",
            capField: "max_tokens",
            outcomes: [
              outcome("baseline", "accepted"),
              { caseId: anthropicCases[0], status: "rejected", httpStatus: 402, error: "You exceeded your current quota", latencyMs: 1 },
              {
                caseId: anthropicCases[1],
                status: "rejected",
                httpStatus: 400,
                error: "Could not finish the message because max_tokens or model output limit was reached.",
                latencyMs: 1,
              },
              { caseId: anthropicCases[2], status: "rejected", httpStatus: 400, error: "temperature is not supported", latencyMs: 1 },
            ],
          },
        ],
      },
    ]);

    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], indexReport(legacy), async () => ["claude-legacy"]);
    const pending = plan.providers[0].models[0].featureCases.map((probeCase) => probeCase.id);

    assert.ok(pending.includes(anthropicCases[0]), "a 402 is retried");
    assert.ok(pending.includes(anthropicCases[1]), "an output-limit error is retried");
    assert.ok(!pending.includes(anthropicCases[2]), "a real rejection is kept");
  });

  it("never probes a model the filter now hides, even when it was unfinished", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], indexReport(previous), async () => ["claude-done"]);
    const sent: string[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent.push((JSON.parse(init.body as string) as { model: string }).model);
      return new Response('{"content":[]}', { status: 200 });
    }) as typeof fetch;

    const [report] = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });

    assert.equal(plan.totalRequests, 0);
    assert.deepEqual(sent, []);
    assert.deepEqual(
      report.models.map((model) => model.modelId),
      ["claude-done"],
    );
  });

  it("merges kept and new outcomes in case order and keeps other providers", async () => {
    const plan = await planCapabilityProbe([{ providerName: "anthropic", apiKey: KEY }], indexReport(previous), async () => ["claude-half"]);
    const fakeFetch = (async () => new Response('{"content":[]}', { status: 200 })) as typeof fetch;

    const fresh = await runCapabilityProbe(plan, { signal: new AbortController().signal, onProgress: () => {}, fetchImpl: fakeFetch, sleep: noSleep });
    const merged = mergeReports(previous, fresh);

    const half = merged[0].models[0];
    assert.deepEqual(
      half.outcomes.map((entry) => entry.caseId),
      ["baseline", ...anthropicCases],
    );
    assert.ok(half.outcomes.every((entry) => entry.status === "accepted"));
    assert.deepEqual(
      merged.map((provider) => provider.providerName),
      ["anthropic", "groq"],
    );
  });
});
