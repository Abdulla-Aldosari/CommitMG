// Resume support for the capability probe. A previous report tells which
// cases already have a final answer; only the rest is re-probed, and the new
// results are merged back into one report. Pure and vscode-free.
//
// Rules:
// - Final outcomes ("accepted", "rejected") are kept and never re-sent.
// - Every other outcome (rate limit, billing block, output limit, network
//   error, cancellation) and every case missing from the report is
//   re-probed. Stored failures are reclassified with the current rules
//   first, so a report from an older probe version that recorded a 402 or
//   an output-limit error as "rejected" is still retried.
// - Only models in the CURRENT filtered list are considered: a model that
//   the filter now hides is dropped from the plan and from the merged
//   report, so an excluded model is never probed again.

import { classifyFailure, type ProbeOutcome, type ProbeStatus } from "./probeResult";
import type { ModelProbeReport, ProviderProbeReport } from "./runProbe";
import type { CapField } from "./probeCases";

const FINAL_STATUSES: ReadonlySet<ProbeStatus> = new Set(["accepted", "rejected"]);

export interface ProbeReportFile {
  generatedAt: string;
  durationMs: number;
  cancelled: boolean;
  providers: ProviderProbeReport[];
}

export function isFinal(outcome: ProbeOutcome): boolean {
  const status = outcome.status === "rejected" ? classifyFailure(outcome.httpStatus, outcome.error) : outcome.status;
  return FINAL_STATUSES.has(status);
}

// Keyed lookup of a previous report: provider -> model -> its report.
export type PreviousResults = Map<string, Map<string, ModelProbeReport>>;

export function indexReport(report: ProbeReportFile | undefined): PreviousResults {
  const index: PreviousResults = new Map();
  for (const provider of report?.providers ?? []) {
    const models = new Map<string, ModelProbeReport>();
    for (const model of provider.models) {
      models.set(model.modelId, model);
    }
    index.set(provider.providerName, models);
  }
  return index;
}

// The finished outcomes a previous run already has for one model, keyed by
// case id. Empty when the model was never probed.
export function finishedCases(previous: PreviousResults, providerName: string, modelId: string): Map<string, ProbeOutcome> {
  const finished = new Map<string, ProbeOutcome>();
  for (const outcome of previous.get(providerName)?.get(modelId)?.outcomes ?? []) {
    if (isFinal(outcome)) {
      finished.set(outcome.caseId, outcome);
    }
  }
  return finished;
}

// The cap field a previous run already settled for one model, if any.
export function previousCapField(previous: PreviousResults, providerName: string, modelId: string): CapField | null {
  return previous.get(providerName)?.get(modelId)?.capField ?? null;
}

// Merges one model's previous final outcomes with the newly sent ones, in
// the order of caseOrder. A new outcome replaces an older one for the same
// case.
export function mergeModelOutcomes(previousFinal: Map<string, ProbeOutcome>, fresh: readonly ProbeOutcome[], caseOrder: readonly string[]): ProbeOutcome[] {
  const byCase = new Map(previousFinal);
  for (const outcome of fresh) {
    byCase.set(outcome.caseId, outcome);
  }
  const ordered = caseOrder.filter((caseId) => byCase.has(caseId)).map((caseId) => byCase.get(caseId) as ProbeOutcome);
  const extra = [...byCase.values()].filter((outcome) => !caseOrder.includes(outcome.caseId));
  return [...ordered, ...extra];
}

// Builds the merged report: the providers of this run replace their earlier
// entries (restricted to the current model lists); providers not part of
// this run are copied unchanged from the previous report.
export function mergeReports(previous: ProbeReportFile | undefined, fresh: readonly ProviderProbeReport[]): ProviderProbeReport[] {
  const freshNames = new Set(fresh.map((provider) => provider.providerName));
  const untouched = (previous?.providers ?? []).filter((provider) => !freshNames.has(provider.providerName));
  return [...fresh, ...untouched];
}
