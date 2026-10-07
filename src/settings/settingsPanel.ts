// The CommitMG Settings WebviewPanel: lets the user pick a pathway
// ("direct" HTTP to one of 8 providers + custom, or "vscode" via Copilot
// Chat's Language Model API), a model, and (for "direct") store an API key
// in context.secrets. Follows RunBox's single-panel-instance pattern and
// MindStream's custom-select dropdown component (media/customSelect.js).

import * as vscode from "vscode";
import { getProviderConfig, getProvidersArray, type DirectProviderName, type ProviderConfig } from "../ai/providersConfig";
import { createAiClient, listModelsForProvider, type AiSelection } from "../ai/aiClientFactory";
import type { AiClient } from "../ai/aiClient";
import { extractAiErrorMessage } from "../ai/extractAiErrorMessage";
import { VsCodeLmAccessorImpl } from "./vsCodeLmAccessorImpl";
import { readAiSettings, writeAiSettings, readApiKey, writeApiKey, deleteApiKey, readAllKeyStatuses, toAiSelection, type AiSettingsSnapshot } from "./settingsStore";

type IncomingMessage =
  | { type: "ready" }
  | { type: "selectVsCodePathway" }
  | { type: "selectProvider"; providerName: DirectProviderName }
  | { type: "selectModel"; modelId: string }
  | { type: "selectVsCodeModel"; modelId: string }
  | { type: "setCustomBaseUrl"; url: string }
  | { type: "saveApiKey"; providerName: DirectProviderName; apiKey: string }
  | { type: "deleteApiKey"; providerName: DirectProviderName }
  | { type: "refreshModel"; selection: AiSelection }
  | { type: "refreshAllModels" }
  | { type: "checkConnection" }
  | { type: "checkRateLimits" }
  | { type: "openExternalUrl"; url: string };

interface SerializableProviderConfig extends Omit<ProviderConfig, "steps"> {
  steps: readonly string[];
}

interface SettingsViewState extends AiSettingsSnapshot {
  hasApiKey: boolean;
  providers: SerializableProviderConfig[];
  keyStatus: Record<DirectProviderName, boolean>;
}

// Identifies a model cache entry client-side: "vscode" for the Language
// Model pathway, or the provider name (including "custom") for the direct
// pathway. Mirrors how RunBox keys its localStorage model cache per provider.
function keyForSelection(selection: AiSelection): string {
  return selection.pathway === "vscode" ? "vscode" : selection.providerName;
}

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext): void {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel("commitmgSettings", "CommitMG Settings", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    });

    SettingsPanel.currentPanel = new SettingsPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => void this.handleMessage(message), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private dispose(): void {
    SettingsPanel.currentPanel = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          await this.postState();
          return;
        case "selectVsCodePathway":
          await writeAiSettings({ pathway: "vscode" });
          await this.postState();
          return;
        case "selectProvider":
          await writeAiSettings({ pathway: "direct", providerName: message.providerName, modelId: "" });
          await this.postState();
          return;
        case "selectModel":
          await writeAiSettings({ modelId: message.modelId });
          await this.postState();
          return;
        case "selectVsCodeModel":
          await writeAiSettings({ vsCodeModelId: message.modelId });
          await this.postState();
          return;
        case "setCustomBaseUrl":
          await writeAiSettings({ customBaseUrl: message.url });
          await this.postState();
          return;
        case "saveApiKey":
          await writeApiKey(this.context, message.providerName, message.apiKey.trim());
          await this.panel.webview.postMessage({ type: "saveApiKeyResult", success: true });
          await this.postState();
          return;
        case "deleteApiKey":
          await deleteApiKey(this.context, message.providerName);
          await this.postState();
          return;
        case "refreshModel":
          await this.handleRefreshModel(message.selection);
          return;
        case "refreshAllModels":
          await this.handleRefreshAllModels();
          return;
        case "checkConnection":
          await this.handleCheckConnection();
          return;
        case "checkRateLimits":
          await this.handleCheckRateLimits();
          return;
        case "openExternalUrl":
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
          return;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`CommitMG Settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Builds the AiClient for one selection, reading its API key from secrets
  // when the pathway is "direct". Shared by handleRefreshModel(),
  // handleRefreshAllModels(), handleCheckConnection() and
  // handleCheckRateLimits() so every call site resolves the client the same
  // way.
  private async buildClientFor(selection: AiSelection): Promise<AiClient> {
    if (selection.pathway === "vscode") {
      return createAiClient(selection, undefined, new VsCodeLmAccessorImpl());
    }
    return createAiClient(selection, await readApiKey(this.context, selection.providerName));
  }

  // Fetches the model list for exactly one selection and posts a single
  // tagged result back. Used both for the automatic fetch that fires when
  // the user switches provider/pathway with no fresh cache, and for the
  // "custom" provider's automatic fetch once a plausible Base URL is typed.
  private async handleRefreshModel(selection: AiSelection): Promise<void> {
    const cacheKey = keyForSelection(selection);
    try {
      const client = await this.buildClientFor(selection);
      // listModelsForProvider() fetches the list and applies the centralized
      // filtering rules (fixed providers only; "custom" and "vscode" pass
      // through unfiltered).
      const models = await listModelsForProvider(client);
      await this.panel.webview.postMessage({ type: "modelsResult", cacheKey, success: true, models });
    } catch (error) {
      await this.panel.webview.postMessage({ type: "modelsResult", cacheKey, success: false, message: extractAiErrorMessage(error) });
    }
  }

  // Refreshes every direct provider that has a saved API key, plus the
  // "custom" provider when it has a base URL configured, plus the "vscode"
  // pathway (which needs no key). Mirrors RunBox's handleAiRefreshAllModels:
  // one tagged result per provider, fetched in parallel via
  // Promise.allSettled so one failing provider never blocks the rest.
  private async handleRefreshAllModels(): Promise<void> {
    const settings = readAiSettings();
    const keyStatus = await readAllKeyStatuses(this.context);

    const selections: AiSelection[] = [];
    for (const providerName of Object.keys(keyStatus) as DirectProviderName[]) {
      if (providerName === "custom") {
        continue;
      }
      if (keyStatus[providerName]) {
        selections.push({ pathway: "direct", providerName, modelId: "" });
      }
    }
    if (keyStatus.custom && settings.customBaseUrl.trim()) {
      selections.push({ pathway: "direct", providerName: "custom", modelId: "", customBaseUrl: settings.customBaseUrl.trim() });
    }
    selections.push({ pathway: "vscode" });

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CommitMG: Refreshing all models...", cancellable: false }, () =>
      Promise.allSettled(selections.map((selection) => this.handleRefreshModel(selection))),
    );
  }

  private async handleCheckConnection(): Promise<void> {
    const settings = readAiSettings();
    const selection = toAiSelection(settings);

    try {
      const client = await this.buildClientFor(selection);
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CommitMG: Checking connection...", cancellable: false }, () =>
        client.checkConnection(),
      );
      await this.panel.webview.postMessage({ type: "connectionResult", success: true });
    } catch (error) {
      await this.panel.webview.postMessage({ type: "connectionResult", success: false, message: extractAiErrorMessage(error) });
    }
  }

  private async handleCheckRateLimits(): Promise<void> {
    const settings = readAiSettings();
    const selection = toAiSelection(settings);

    if (selection.pathway === "vscode") {
      await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: false });
      return;
    }

    try {
      const client = await this.buildClientFor(selection);
      if (!client.checkRateLimits) {
        // No proactive rate-limit endpoint: hand the webview the provider's
        // own rate-limit page so it can link there (RunBox behavior).
        const config = getProviderConfig(selection.providerName);
        await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: false, rateLimitsUrl: config ? config.rateLimitsUrl : "" });
        return;
      }

      const info = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CommitMG: Checking rate limits...", cancellable: false }, () =>
        client.checkRateLimits!(),
      );
      await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: true, info });
    } catch (error) {
      await this.panel.webview.postMessage({ type: "rateLimitsResult", success: false, supported: true, message: extractAiErrorMessage(error) });
    }
  }

  private async postState(): Promise<void> {
    const settings = readAiSettings();
    const keyStatus = await readAllKeyStatuses(this.context);
    const hasApiKey = settings.pathway === "direct" ? Boolean(keyStatus[settings.providerName]) : false;

    const state: SettingsViewState = {
      ...settings,
      hasApiKey,
      keyStatus,
      providers: getProvidersArray().map((p) => ({ ...p })),
    };

    await this.panel.webview.postMessage({ type: "state", state });
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const extensionUri = this.context.extensionUri;
    const tooltipUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "tooltip.js"));
    const customSelectUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "customSelect.js"));
    const iconsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "icons.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settings.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settingsMain.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>CommitMG Settings</title>
</head>
<body>
  <div id="app">
    <header class="settings-header">
      <h1>CommitMG Settings</h1>
    </header>

    <section class="tabs-section tabs-centered">
      <div class="tabs">
        <button class="tab active" data-tab="ai">AI Settings</button>
        <!-- Future: <button class="tab" data-tab="commit">Commit Message</button> -->
      </div>
    </section>

    <section id="tab-content" class="card">
      <!-- AI Settings tab content is rendered here by renderAiSettingsTab() -->
    </section>
  </div>

  <div id="ai-setup-help-modal" class="modal" hidden></div>

  <!-- Single shared modal for connection tests, rate limits, and fetch
       errors. Persistent in the page shell, toggled via the hidden
       attribute; kind (success/error/info) colors only the title icon and
       the text, never the card chrome. -->
  <div id="message-modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <span id="message-modal-title" class="modal-title"></span>
        <button id="message-modal-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="message-modal-body" class="message-modal-body"></div>
      <div class="modal-actions">
        <button id="message-modal-ok" class="btn btn-ghost min-w70">OK</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${tooltipUri}"></script>
  <script nonce="${nonce}" src="${customSelectUri}"></script>
  <script nonce="${nonce}" src="${iconsUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
