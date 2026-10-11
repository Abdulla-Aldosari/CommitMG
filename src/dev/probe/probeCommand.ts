// The "Probe Model Capabilities (Developer)" command. The user picks which
// providers to probe (every direct provider with a saved API key, plus
// "custom" when it has a base URL), then either a fresh run or a resume of
// an earlier report. A resume re-sends only the cases that never got a final
// answer, for models still in the current filtered list, and merges the
// results into one new report. The run asks for consent with the exact
// request count, runs under a cancellable progress notification, and writes
// a JSON report to the extension's global storage. The report never
// contains API keys, prompts, or reply text: only statuses, provider error
// messages, response shapes, finish reasons, and token counts.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getProvidersArray } from "../../ai/providersConfig";
import { readAiSettings, readApiKey } from "../../settings/settingsStore";
import { developerDiagnosticsEnabled } from "../devSessionRecorder";
import { planCapabilityProbe, runCapabilityProbe, type ProbeProviderInput } from "./runProbe";
import { indexReport, mergeReports, type ProbeReportFile } from "./resumeProbe";

export const PROBE_COMMAND_ID = "commitmg.probeModelCapabilities";

const REPORT_PREFIX = "capability-probe-";

function reportDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "probe-reports");
}

// Lets the user choose the providers to probe. All are preselected only when
// there is a single one, so a run never hits every provider by accident.
async function pickProviders(inputs: ProbeProviderInput[]): Promise<ProbeProviderInput[] | undefined> {
  const picked = await vscode.window.showQuickPick(
    inputs.map((input) => ({ label: input.providerName, picked: inputs.length === 1, input })),
    { canPickMany: true, title: "Commit MG: Probe which providers?", placeHolder: "Select one or more providers", ignoreFocusOut: true },
  );
  return picked && picked.length > 0 ? picked.map((item) => item.input) : undefined;
}

// Lets the user resume an earlier report (newest first) or start fresh.
// Returns null for a fresh run, undefined when the user cancels.
async function pickPreviousReport(context: vscode.ExtensionContext): Promise<ProbeReportFile | null | undefined> {
  const dir = reportDir(context);
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.startsWith(REPORT_PREFIX) && name.endsWith(".json"))
        .sort()
        .reverse()
    : [];
  const fresh = { label: "$(debug-start) Fresh run", description: "Probe every case again", file: undefined as string | undefined };
  const resumes = files.map((name) => ({ label: `$(history) Resume ${name}`, description: "Re-send only unfinished cases", file: name }));
  const choice = await vscode.window.showQuickPick([...resumes, fresh], { title: "Commit MG: Fresh probe or resume a report?", ignoreFocusOut: true });
  if (!choice) {
    return undefined;
  }
  if (!choice.file) {
    return null;
  }
  return JSON.parse(fs.readFileSync(path.join(dir, choice.file), "utf8")) as ProbeReportFile;
}

async function collectInputs(context: vscode.ExtensionContext): Promise<ProbeProviderInput[]> {
  const inputs: ProbeProviderInput[] = [];
  for (const provider of getProvidersArray()) {
    const apiKey = await readApiKey(context, provider.name);
    if (apiKey) {
      inputs.push({ providerName: provider.name, apiKey });
    }
  }
  const customBaseUrl = readAiSettings().customBaseUrl.trim();
  if (customBaseUrl) {
    inputs.push({ providerName: "custom", apiKey: (await readApiKey(context, "custom")) ?? "", customBaseUrl });
  }
  return inputs;
}

function reportPath(context: vscode.ExtensionContext): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = reportDir(context);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${REPORT_PREFIX}${stamp}.json`);
}

export async function runProbeCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!developerDiagnosticsEnabled()) {
    vscode.window.showWarningMessage("Commit MG: the capability probe is a developer tool. Enable the commitmg.developer.enabled setting to use it.");
    return;
  }

  const available = await collectInputs(context);
  if (available.length === 0) {
    vscode.window.showWarningMessage("Commit MG: no provider has a saved API key. Add a key in CommitMG Settings first.");
    return;
  }

  const inputs = await pickProviders(available);
  if (!inputs) {
    return;
  }
  const previousReport = await pickPreviousReport(context);
  if (previousReport === undefined) {
    return;
  }

  const plan = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Commit MG: Listing models for the probe..." }, () =>
    planCapabilityProbe(inputs, indexReport(previousReport ?? undefined)),
  );

  const summary = plan.providers
    .map((provider) => (provider.modelListError ? `${provider.target.providerName}: model list failed` : `${provider.target.providerName}: ${provider.models.length} models`))
    .join(", ");
  if (plan.totalRequests === 0) {
    vscode.window.showWarningMessage(`Commit MG: nothing left to probe (${summary}${plan.skippedCases > 0 ? `; ${plan.skippedCases} cases already finished` : ""}).`);
    return;
  }

  const confirm = "Run probe";
  const skipped = plan.skippedCases > 0 ? ` ${plan.skippedCases} cases already finished in the earlier report are skipped.` : "";
  const answer = await vscode.window.showWarningMessage(
    `Commit MG: the probe will send up to ${plan.totalRequests} small requests (${summary}).${skipped} A rate-limited request is retried once after a short wait; a model still rate limited after that is skipped. The requests count against your API usage and rate limits.`,
    { modal: true },
    confirm,
  );
  if (answer !== confirm) {
    return;
  }

  const controller = new AbortController();
  const startedAt = new Date();
  const providers = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Commit MG: Probing model capabilities", cancellable: true },
    (progress, token) => {
      token.onCancellationRequested(() => controller.abort());
      let lastDone = 0;
      return runCapabilityProbe(plan, {
        signal: controller.signal,
        onProgress: ({ providerName, modelId, done, total, waitingMs }) => {
          const waiting = waitingMs === undefined ? "" : ` (rate limited, retrying in ${Math.ceil(waitingMs / 1000)}s)`;
          progress.report({ message: `${done}/${total} - ${providerName} / ${modelId}${waiting}`, increment: ((done - lastDone) / total) * 100 });
          lastDone = done;
        },
      });
    },
  );

  const file = reportPath(context);
  const report: ProbeReportFile = {
    generatedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    cancelled: controller.signal.aborted,
    providers: mergeReports(previousReport ?? undefined, providers),
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

  const open = "Open report";
  const choice = await vscode.window.showInformationMessage(`Commit MG: probe ${controller.signal.aborted ? "cancelled" : "finished"}. Report saved to ${file}`, open);
  if (choice === open) {
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
  }
}
