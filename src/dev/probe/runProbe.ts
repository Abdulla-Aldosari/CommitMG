// Runs the capability probe: for the chosen providers, every model in their
// live (filtered) list, and every probe case, sends one tiny request and
// records the outcome. Requests run one at a time. A rate-limited request
// waits a short time and is retried once; if the model is still rate
// limited, the rest of that model is skipped (limits are per model) and the
// run moves on to the next model; a later resume run picks those cases up.
// vscode-free: the caller supplies the targets, a progress callback, and a
// cancellation signal.

import { createAiClient, listModelsForProvider, type DirectAiSelection } from "../../ai/aiClientFactory";
import { OPENAI_COMPATIBLE_BASE_URLS, type DirectProviderName } from "../../ai/providersConfig";
import { buildProbeRequest, capProbeCases, featureProbeCases, wireFormatFor, type CapField, type ProbeCase, type ProbeRequest, type ProbeTarget } from "./probeCases";
import { rateLimitDelayMs, summarizeResponse, type ProbeOutcome } from "./probeResult";
import { finishedCases, mergeModelOutcomes, previousCapField, type PreviousResults } from "./resumeProbe";

const REQUEST_TIMEOUT_MS = 60000;
const PAUSE_BETWEEN_REQUESTS_MS = 250;
// Retries after a 429, each after a short wait (see rateLimitDelayMs).
export const RATE_LIMIT_RETRIES = 1;

export interface ProbeProviderInput {
  providerName: DirectProviderName;
  apiKey: string;
  customBaseUrl?: string;
}

export interface ModelProbeReport {
  modelId: string;
  // The output-cap field the model accepted, or null when none worked.
  capField: CapField | null;
  outcomes: ProbeOutcome[];
}

export interface ProviderProbeReport {
  providerName: DirectProviderName;
  wireFormat: string;
  modelListError?: string;
  models: ModelProbeReport[];
}

export interface ProbeProgress {
  providerName: DirectProviderName;
  modelId: string;
  caseId: string;
  done: number;
  total: number;
  // Set while the run waits before retrying a rate-limited request.
  waitingMs?: number;
}

export interface ProbeRunOptions {
  signal: AbortSignal;
  onProgress: (progress: ProbeProgress) => void;
  // Injected for tests; default to the global fetch and a real timer that
  // ends early when the run is cancelled.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

async function listLiveModels(input: ProbeProviderInput): Promise<string[]> {
  const selection: DirectAiSelection = { pathway: "direct", providerName: input.providerName, modelId: "", customBaseUrl: input.customBaseUrl };
  return (await listModelsForProvider(createAiClient(selection, input.apiKey))).map((model) => model.modelId);
}

function targetFor(input: ProbeProviderInput): ProbeTarget {
  const baseUrl = input.providerName === "custom" ? (input.customBaseUrl ?? "") : (OPENAI_COMPATIBLE_BASE_URLS[input.providerName] ?? "");
  return { providerName: input.providerName, wireFormat: wireFormatFor(input.providerName), baseUrl, apiKey: input.apiKey };
}

// Sends one request once. Never throws: network failures, timeouts, and
// cancellation all become outcomes. Also returns the Retry-After header so
// the caller can time a retry after a 429.
async function sendCase(caseId: string, request: ProbeRequest, options: ProbeRunOptions): Promise<{ outcome: ProbeOutcome; retryAfter: string | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.signal.aborted) {
    return { outcome: { caseId, status: "cancelled", latencyMs: 0 }, retryAfter: null };
  }
  const started = Date.now();
  try {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    const response = await fetchImpl(request.url, { ...request.init, signal });
    const bodyText = await response.text();
    return { outcome: summarizeResponse(caseId, response.status, bodyText, Date.now() - started), retryAfter: response.headers.get("retry-after") };
  } catch (error) {
    if (options.signal.aborted) {
      return { outcome: { caseId, status: "cancelled", latencyMs: Date.now() - started }, retryAfter: null };
    }
    return { outcome: { caseId, status: "network_error", error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started }, retryAfter: null };
  }
}

// What one model still needs: every case without a final outcome in the
// previous report. The cap cases run only while the cap field is unknown.
export interface ModelWork {
  modelId: string;
  capField: CapField | null;
  previousFinal: Map<string, ProbeOutcome>;
  capCases: Array<{ probeCase: ProbeCase; capField: CapField }>;
  featureCases: ProbeCase[];
}

export function modelWork(target: ProbeTarget, modelId: string, previous: PreviousResults): ModelWork {
  const previousFinal = finishedCases(previous, target.providerName, modelId);
  const capField = previousCapField(previous, target.providerName, modelId);
  const capCases = capField === null ? capProbeCases(target.wireFormat).filter(({ probeCase }) => !previousFinal.has(probeCase.id)) : [];
  const featureCases = featureProbeCases(target).filter((probeCase) => !previousFinal.has(probeCase.id));
  return { modelId, capField, previousFinal, capCases, featureCases };
}

function caseOrder(target: ProbeTarget): string[] {
  return [...capProbeCases(target.wireFormat).map(({ probeCase }) => probeCase.id), ...featureProbeCases(target).map((probeCase) => probeCase.id)];
}

async function probeModel(
  target: ProbeTarget,
  work: ModelWork,
  options: ProbeRunOptions,
  tick: (caseId: string) => void,
  wait: (caseId: string, ms: number) => void,
): Promise<ModelProbeReport> {
  const sleep = options.sleep ?? realSleep;
  const fresh: ProbeOutcome[] = [];
  let capField = work.capField;
  let rateLimited = false;

  // Sends one case. A 429 waits a short time (the provider's hint when it
  // gives one) and retries; only a 429 on the last try marks the model as
  // rate limited, which ends this model.
  const send = async (probeCase: ProbeCase, field: CapField): Promise<ProbeOutcome> => {
    const request = buildProbeRequest(target, work.modelId, probeCase, field);
    let { outcome, retryAfter } = await sendCase(probeCase.id, request, options);
    for (let retry = 0; retry < RATE_LIMIT_RETRIES && outcome.status === "rate_limited" && !options.signal.aborted; retry++) {
      const delay = rateLimitDelayMs(retryAfter, outcome.error);
      wait(probeCase.id, delay);
      await sleep(delay, options.signal);
      if (options.signal.aborted) {
        break;
      }
      ({ outcome, retryAfter } = await sendCase(probeCase.id, request, options));
    }
    fresh.push(outcome);
    tick(probeCase.id);
    rateLimited = outcome.status === "rate_limited";
    await sleep(PAUSE_BETWEEN_REQUESTS_MS, options.signal);
    return outcome;
  };

  // Find the output-cap field first; every feature case reuses it so a
  // feature never fails only because of the cap field name.
  for (const { probeCase, capField: candidate } of work.capCases) {
    if (options.signal.aborted || rateLimited) {
      break;
    }
    const outcome = await send(probeCase, candidate);
    if (capField === null && outcome.status === "accepted") {
      capField = candidate;
    }
  }

  for (const probeCase of work.featureCases) {
    if (options.signal.aborted || rateLimited) {
      break;
    }
    await send(probeCase, capField ?? "max_tokens");
  }

  return { modelId: work.modelId, capField, outcomes: mergeModelOutcomes(work.previousFinal, fresh, caseOrder(target)) };
}

export interface ProviderProbePlan {
  target: ProbeTarget;
  models: ModelWork[];
  modelListError?: string;
}

export interface ProbePlan {
  providers: ProviderProbePlan[];
  // Requests still to send, not counting rate-limit retries. A model that
  // stays rate limited ends early, so the real count can be lower.
  totalRequests: number;
  // Cases already final in the previous report, so not sent again.
  skippedCases: number;
}

// Step 1: lists the live (filtered) models of every chosen provider and
// works out what is left to probe. Sends no probe request, so the caller can
// show the request count and ask for consent. The plan is built from the
// CURRENT filtered list only: a model the filter now hides is not listed,
// so an unfinished entry for it in the previous report is ignored.
export async function planCapabilityProbe(
  inputs: readonly ProbeProviderInput[],
  previous: PreviousResults = new Map(),
  listModels: (input: ProbeProviderInput) => Promise<string[]> = listLiveModels,
): Promise<ProbePlan> {
  const providers: ProviderProbePlan[] = [];
  let totalRequests = 0;
  let skippedCases = 0;
  for (const input of inputs) {
    const target = targetFor(input);
    try {
      const models = (await listModels(input)).map((modelId) => modelWork(target, modelId, previous));
      for (const work of models) {
        totalRequests += work.capCases.length + work.featureCases.length;
        skippedCases += work.previousFinal.size;
      }
      providers.push({ target, models });
    } catch (error) {
      providers.push({ target, models: [], modelListError: error instanceof Error ? error.message : String(error) });
    }
  }
  return { providers, totalRequests, skippedCases };
}

// Step 2: sends every planned request, one at a time. Models with nothing
// left to send keep their previous final outcomes.
export async function runCapabilityProbe(plan: ProbePlan, options: ProbeRunOptions): Promise<ProviderProbeReport[]> {
  const reports: ProviderProbeReport[] = [];
  let done = 0;

  for (const provider of plan.providers) {
    const report: ProviderProbeReport = { providerName: provider.target.providerName, wireFormat: provider.target.wireFormat, models: [] };
    if (provider.modelListError) {
      report.modelListError = provider.modelListError;
    }
    for (const work of provider.models) {
      if (options.signal.aborted) {
        report.models.push({ modelId: work.modelId, capField: work.capField, outcomes: [...work.previousFinal.values()] });
        continue;
      }
      const tick = (caseId: string): void => {
        done++;
        options.onProgress({ providerName: provider.target.providerName, modelId: work.modelId, caseId, done, total: plan.totalRequests });
      };
      const wait = (caseId: string, ms: number): void => {
        options.onProgress({ providerName: provider.target.providerName, modelId: work.modelId, caseId, done, total: plan.totalRequests, waitingMs: ms });
      };
      report.models.push(await probeModel(provider.target, work, options, tick, wait));
    }
    reports.push(report);
  }

  return reports;
}
