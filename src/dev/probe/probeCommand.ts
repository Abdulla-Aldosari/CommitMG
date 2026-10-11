// The "Probe Model Capabilities (Developer)" command. Collects every direct
// provider with a saved API key (plus "custom" when it has a base URL),
// lists their live models, asks for consent with the exact request count,
// then runs the probe under a cancellable progress notification and writes a
// JSON report to the extension's global storage. The report never contains
// API keys, prompts, or reply text: only statuses, provider error messages,
// response shapes, finish reasons, and token counts.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getProvidersArray } from "../../ai/providersConfig";
import { readAiSettings, readApiKey } from "../../settings/settingsStore";
import { developerDiagnosticsEnabled } from "../devSessionRecorder";
import { planCapabilityProbe, runCapabilityProbe, type ProbeProviderInput } from "./runProbe";
import { PROBE_OUTPUT_TOKENS, SHAPE_OUTPUT_TOKENS } from "./probeCases";

export const PROBE_COMMAND_ID = "commitmg.probeModelCapabilities";

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
  const dir = path.join(context.globalStorageUri.fsPath, "probe-reports");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `capability-probe-${stamp}.json`);
}

export async function runProbeCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!developerDiagnosticsEnabled()) {
    vscode.window.showWarningMessage("Commit MG: the capability probe is a developer tool. Enable the commitmg.developer.enabled setting to use it.");
    return;
  }

  const inputs = await collectInputs(context);
  if (inputs.length === 0) {
    vscode.window.showWarningMessage("Commit MG: no provider has a saved API key. Add a key in CommitMG Settings first.");
    return;
  }

  const plan = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Commit MG: Listing models for the probe..." }, () =>
    planCapabilityProbe(inputs),
  );

  const summary = plan.providers
    .map((provider) => (provider.modelListError ? `${provider.target.providerName}: model list failed` : `${provider.target.providerName}: ${provider.modelIds.length} models`))
    .join(", ");
  if (plan.totalRequests === 0) {
    vscode.window.showWarningMessage(`Commit MG: nothing to probe (${summary}).`);
    return;
  }

  const confirm = "Run probe";
  const answer = await vscode.window.showWarningMessage(
    `Commit MG: the probe will send ${plan.totalRequests} small requests to your providers (${summary}). Most cap the reply at ${PROBE_OUTPUT_TOKENS} tokens; a few use up to ${SHAPE_OUTPUT_TOKENS} to record the reply shape. They count against your API usage and rate limits.`,
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
        onProgress: ({ providerName, modelId, done, total }) => {
          progress.report({ message: `${done}/${total} - ${providerName} / ${modelId}`, increment: ((done - lastDone) / total) * 100 });
          lastDone = done;
        },
      });
    },
  );

  const file = reportPath(context);
  const report = {
    generatedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    cancelled: controller.signal.aborted,
    providers,
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");

  const open = "Open report";
  const choice = await vscode.window.showInformationMessage(`Commit MG: probe ${controller.signal.aborted ? "cancelled" : "finished"}. Report saved to ${file}`, open);
  if (choice === open) {
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
  }
}
