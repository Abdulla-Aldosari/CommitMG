// Runs the capability probe: for every provider with a saved key, every model
// in its live (filtered) list, and every probe case, sends one tiny request
// and records the outcome. Requests run one at a time to stay inside rate
// limits; a rate-limited request waits and retries. vscode-free: the caller
// supplies the targets, a progress callback, and a cancellation signal.

import { createAiClient, listModelsForProvider, type DirectAiSelection } from "../../ai/aiClientFactory";
import { OPENAI_COMPATIBLE_BASE_URLS, type DirectProviderName } from "../../ai/providersConfig";
import { buildProbeRequest, capProbeCases, featureProbeCases, requestsPerModel, wireFormatFor, type CapField, type ProbeRequest, type ProbeTarget } from "./probeCases";
import { retryDelayMs, summarizeResponse, type ProbeOutcome } from "./probeResult";

const REQUEST_TIMEOUT_MS = 60000;
const MAX_RATE_LIMIT_RETRIES = 3;
const PAUSE_BETWEEN_REQUESTS_MS = 250;

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
}

export interface ProbeRunOptions {
  signal: AbortSignal;
  onProgress: (progress: ProbeProgress) => void;
  // Injected for tests; default to the global fetch and a real timer.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function listLiveModels(input: ProbeProviderInput): Promise<string[]> {
  const selection: DirectAiSelection = { pathway: "direct", providerName: input.providerName, modelId: "", customBaseUrl: input.customBaseUrl };
  return (await listModelsForProvider(createAiClient(selection, input.apiKey))).map((model) => model.modelId);
}

function targetFor(input: ProbeProviderInput): ProbeTarget {
  const baseUrl = input.providerName === "custom" ? (input.customBaseUrl ?? "") : (OPENAI_COMPATIBLE_BASE_URLS[input.providerName] ?? "");
  return { providerName: input.providerName, wireFormat: wireFormatFor(input.providerName), baseUrl, apiKey: input.apiKey };
}

// Sends one request, retrying a 429 a few times. Never throws: network
// failures, timeouts, and cancellation all become outcomes.
async function sendCase(caseId: string, request: ProbeRequest, options: ProbeRunOptions): Promise<ProbeOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    if (options.signal.aborted) {
      return { caseId, status: "cancelled", latencyMs: 0 };
    }
    const started = Date.now();
    try {
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const response = await fetchImpl(request.url, { ...request.init, signal });
      const bodyText = await response.text();
      const outcome = summarizeResponse(caseId, response.status, bodyText, Date.now() - started);
      if (outcome.status === "rate_limited" && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      return outcome;
    } catch (error) {
      if (options.signal.aborted) {
        return { caseId, status: "cancelled", latencyMs: Date.now() - started };
      }
      return { caseId, status: "network_error", error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started };
    }
  }
}

async function probeModel(target: ProbeTarget, modelId: string, options: ProbeRunOptions, tick: (caseId: string) => void): Promise<ModelProbeReport> {
  const sleep = options.sleep ?? realSleep;
  const outcomes: ProbeOutcome[] = [];
  let capField: CapField | null = null;

  // Find the output-cap field first; every feature case reuses it so a
  // feature never fails only because of the cap field name.
  for (const { probeCase, capField: candidate } of capProbeCases(target.wireFormat)) {
    const outcome = await sendCase(probeCase.id, buildProbeRequest(target, modelId, probeCase, candidate), options);
    outcomes.push(outcome);
    tick(probeCase.id);
    if (capField === null && outcome.status === "accepted") {
      capField = candidate;
    }
    await sleep(PAUSE_BETWEEN_REQUESTS_MS);
  }

  for (const probeCase of featureProbeCases(target)) {
    if (options.signal.aborted) {
      break;
    }
    const outcome = await sendCase(probeCase.id, buildProbeRequest(target, modelId, probeCase, capField ?? "max_tokens"), options);
    outcomes.push(outcome);
    tick(probeCase.id);
    await sleep(PAUSE_BETWEEN_REQUESTS_MS);
  }

  return { modelId, capField, outcomes };
}

export interface ProviderProbePlan {
  target: ProbeTarget;
  modelIds: string[];
  modelListError?: string;
}

export interface ProbePlan {
  providers: ProviderProbePlan[];
  totalRequests: number;
}

// Step 1: lists the live models of every provider. Sends no probe request,
// so the caller can show the planned request count and ask for consent.
export async function planCapabilityProbe(
  inputs: readonly ProbeProviderInput[],
  listModels: (input: ProbeProviderInput) => Promise<string[]> = listLiveModels,
): Promise<ProbePlan> {
  const providers: ProviderProbePlan[] = [];
  for (const input of inputs) {
    const target = targetFor(input);
    try {
      providers.push({ target, modelIds: await listModels(input) });
    } catch (error) {
      providers.push({ target, modelIds: [], modelListError: error instanceof Error ? error.message : String(error) });
    }
  }
  const totalRequests = providers.reduce((sum, plan) => sum + plan.modelIds.length * requestsPerModel(plan.target), 0);
  return { providers, totalRequests };
}

// Step 2: sends every planned request, one at a time.
export async function runCapabilityProbe(plan: ProbePlan, options: ProbeRunOptions): Promise<ProviderProbeReport[]> {
  const plans = plan.providers.map((provider) => ({
    target: provider.target,
    modelIds: provider.modelIds,
    report: { providerName: provider.target.providerName, wireFormat: provider.target.wireFormat, modelListError: provider.modelListError, models: [] } as ProviderProbeReport,
  }));
  const total = plan.totalRequests;
  let done = 0;

  for (const plan of plans) {
    for (const modelId of plan.modelIds) {
      if (options.signal.aborted) {
        break;
      }
      const tick = (caseId: string): void => {
        done++;
        options.onProgress({ providerName: plan.target.providerName, modelId, caseId, done, total });
      };
      plan.report.models.push(await probeModel(plan.target, modelId, options, tick));
    }
  }

  return plans.map((plan) => plan.report);
}
