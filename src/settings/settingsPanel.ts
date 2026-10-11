// The CommitMG Settings WebviewPanel: lets the user pick a pathway
// ("direct" HTTP to one of 8 providers + custom, or "vscode" via Copilot
// Chat's Language Model API), a model, and (for "direct") store an API key
// in context.secrets.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildPromptForRepo, COMMIT_STYLES, generateCommitMessage, NO_CHANGES_ERROR, type CommitStyle } from "../generation";
import { modelSupport, type ModelSupport } from "../ai/params/profileRules";
import { getDefaultModelId, getProviderConfig, getProvidersArray, type DirectProviderName, type ProviderConfig } from "../ai/providersConfig";
import { createAiClient, listModelsForProvider, type AiSelection } from "../ai/aiClientFactory";
import type { AiClient } from "../ai/aiClient";
import { extractAiErrorMessage } from "../ai/extractAiErrorMessage";
import { buildModelCostRows, countPromptTokens, ESTIMATED_OUTPUT_TOKENS, PRICING_RETRIEVED_AT, type CostEstimateResult, type CostEstimateStyleRow } from "../ai/estimatePromptCost";
import { VsCodeLmAccessorImpl } from "./vsCodeLmAccessorImpl";
import { classifyBaseUrl } from "../webview/baseUrl";
import { safeExternalUrl } from "./externalUrl";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../ai/params/generationParams";
import { GENERATION_OPTION_RANGES, type GenerationOptions } from "../generation/options";
import { MAX_OUTPUT_TOKENS_RANGE, TEMPERATURE_RANGE, TIMEOUT_SECONDS_RANGE, type UserSettingKey } from "./userSettings";
import { createRulesFile, readRulesView, rulesSourceFile, writeRulesField, type RulesView } from "./rulesSettings";
import {
  readAiSettings,
  writeAiSettings,
  readApiKey,
  writeApiKey,
  deleteApiKey,
  readAllKeyStatuses,
  readRunSettings,
  readUserSettingsView,
  resetUserSetting,
  toAiSelection,
  writeUserSetting,
  type AiSettingsSnapshot,
  type UserSettingView,
} from "./settingsStore";

// The webview components under media/components/, in load order. Each file
// registers its factory on window.CommitMgComponents.
const WEBVIEW_COMPONENTS: readonly string[] = [
  "toggleSwitch",
  "stepSlider",
  "numberField",
  "segmentedControl",
  "dropdown",
  "settingRow",
  "collapsibleSection",
  "infoBanner",
  "chipList",
  "editableTable",
  "textAreaCounter",
];

// The component-based tabs under media/tabs/. Each file registers its
// factory on window.CommitMgTabs; settingsMain.js adds them to its TABS
// registry.
const WEBVIEW_TABS: readonly string[] = ["speedTab", "rulesTab"];

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
  | { type: "estimateCost" }
  | { type: "openExternalUrl"; url: string }
  | { type: "setUserSetting"; key: string; value: unknown }
  | { type: "resetUserSetting"; key: string }
  | { type: "measurePromptSize"; requestId: number }
  | { type: "setRulesField"; field: string; value: unknown }
  | { type: "createRulesFile" }
  | { type: "openRulesSource" };

interface SerializableProviderConfig extends Omit<ProviderConfig, "steps"> {
  steps: readonly string[];
}

interface SettingsViewState extends AiSettingsSnapshot {
  hasApiKey: boolean;
  providers: SerializableProviderConfig[];
  keyStatus: Record<DirectProviderName, boolean>;
  // Every CommitMG setting stored in VS Code (Speed & Context, Message
  // Format, bullet spacing) with the layer it comes from.
  userSettings: Record<UserSettingKey, UserSettingView>;
  // The options the next generation will use (a named preset's knobs, or
  // the custom values), so the tab shows what is really in effect.
  speedEffective: GenerationOptions;
  speedLimits: typeof SPEED_LIMITS;
  // What the selected direct model accepts, and which model that is; null
  // for the VS Code pathway, which exposes no request parameters.
  modelSupport: (ModelSupport & { modelId: string }) | null;
  // The commit rules of the open repository, for the Rules tab.
  rules: RulesView;
}

// The files that decide the project rules: any commitlint config the
// loader searches for, and the rules file. A change to one redraws the
// panel, so the Rules tab never shows stale rules.
const RULES_WATCH_GLOB = "{package.json,package.yaml,.commitlintrc,.commitlintrc.*,commitlint.config.*,.commitmgrc.json}";

// Identifies a model cache entry client-side: "vscode" for the Language
// Model pathway, or the provider name (including "custom") for the direct
// pathway.
function keyForSelection(selection: AiSelection): string {
  return selection.pathway === "vscode" ? "vscode" : selection.providerName;
}

// Returns the root of the first workspace folder that is a Git repository,
// or undefined when the workspace has none. The settings panel is global, so
// the Estimate Cost button measures whatever repo the user currently has
// open in the workspace.
function findGitRepoRoot(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (fs.existsSync(path.join(folder.uri.fsPath, ".git"))) {
      return folder.uri.fsPath;
    }
  }
  return undefined;
}

// A throwaway AiClient that records the prompts generateCommitMessage()
// builds without sending them anywhere. Used by the Estimate Cost button to
// measure exactly what a real generation would transmit to the provider.
class RecordingAiClient implements AiClient {
  readonly providerName = "custom" as const;
  readonly calls: Array<{ systemPrompt: string; userPrompt: string }> = [];

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    this.calls.push({ systemPrompt, userPrompt });
    return "fix(scope): prompt cost estimate";
  }

  async checkConnection(): Promise<void> {}
}

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private statePostTimer: ReturnType<typeof setTimeout> | undefined;
  // Settings edits from this panel still being written; see
  // scheduleStatePost().
  private pendingSettingsWrites = 0;

  static createOrShow(context: vscode.ExtensionContext): void {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel("commitmgSettings", "CommitMG Settings", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media"), vscode.Uri.joinPath(context.extensionUri, "out", "webview")],
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
    // Any change to CommitMG's settings, from this panel, the Settings
    // editor, or settings.json, redraws the panel from the stored values.
    vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (event.affectsConfiguration("commitmg")) {
          this.scheduleStatePost();
        }
      },
      undefined,
      this.disposables,
    );
    // Edits to the rules files, from this panel or any editor, redraw the
    // Rules tab the same way.
    const rulesWatcher = vscode.workspace.createFileSystemWatcher(`**/${RULES_WATCH_GLOB}`);
    for (const event of [rulesWatcher.onDidCreate, rulesWatcher.onDidChange, rulesWatcher.onDidDelete]) {
      event(() => this.scheduleStatePost(), undefined, this.disposables);
    }
    this.disposables.push(rulesWatcher);
  }

  // One edit can write several settings (a preset switch writes six), and
  // each write fires its own change event. While the panel's own writes run,
  // their events are skipped and the panel redraws once when they end (see
  // applySettingsEdit). Outside edits redraw once after the last event of a
  // burst, instead of drawing every intermediate state.
  private scheduleStatePost(): void {
    if (this.pendingSettingsWrites > 0) {
      return;
    }
    clearTimeout(this.statePostTimer);
    this.statePostTimer = setTimeout(() => {
      this.statePostTimer = undefined;
      void this.postState();
    }, STATE_POST_DELAY_MS);
  }

  private dispose(): void {
    clearTimeout(this.statePostTimer);
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
          if (classifyBaseUrl(message.url) === "insecure") {
            vscode.window.showWarningMessage(
              "CommitMG: the custom base URL uses plain http to another machine. Your API key and code changes will be sent unencrypted; use https or a server on this machine.",
            );
          }
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
        case "estimateCost":
          await this.handleEstimateCost();
          return;
        case "openExternalUrl": {
          const url = safeExternalUrl(message.url);
          if (!url) {
            vscode.window.showWarningMessage("CommitMG Settings: only https links can be opened.");
            return;
          }
          await vscode.env.openExternal(vscode.Uri.parse(url));
          return;
        }
        case "setUserSetting":
          await this.applySettingsEdit(() => writeUserSetting(message.key, message.value));
          return;
        case "resetUserSetting":
          await this.applySettingsEdit(() => resetUserSetting(message.key));
          return;
        case "measurePromptSize":
          await this.handleMeasurePromptSize(message.requestId);
          return;
        case "setRulesField":
          await this.applySettingsEdit(async () => writeRulesField(this.requireRepoRoot(), message.field, message.value));
          return;
        case "createRulesFile":
          await this.applySettingsEdit(async () => createRulesFile(this.requireRepoRoot()));
          return;
        case "openRulesSource": {
          const file = rulesSourceFile(this.requireRepoRoot());
          if (file) {
            await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
          }
          return;
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`CommitMG Settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private requireRepoRoot(): string {
    const repoRoot = findGitRepoRoot();
    if (!repoRoot) {
      throw new Error("open a Git repository first.");
    }
    return repoRoot;
  }

  // Runs one settings edit from the webview and redraws the panel once it
  // is fully written, whether it succeeded or not: a rejected or failed
  // write must still put the controls back to the stored values.
  private async applySettingsEdit(edit: () => Promise<void>): Promise<void> {
    this.pendingSettingsWrites++;
    try {
      await edit();
    } finally {
      this.pendingSettingsWrites--;
      if (this.pendingSettingsWrites === 0) {
        clearTimeout(this.statePostTimer);
        this.statePostTimer = undefined;
        await this.postState();
      }
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
  // pathway (which needs no key). one tagged result per provider, fetched
  // in parallel via Promise.allSettled so one failing provider never blocks the rest.
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

    const config = getProviderConfig(selection.providerName);

    try {
      const client = await this.buildClientFor(selection);
      // The client method alone is not enough: OpenAiCompatibleClient serves
      // openai, deepseek, groq, stepfun and custom from one class, but only
      // providers with hasApiRateLimits actually return rate-limit headers.
      // Gate on the config flag so providers without headers (gemini,
      // deepseek, cohere, stepfun) get the "unsupported" answer with their
      // own rate-limit page link instead of a "? / ?" reading.
      if (!client.checkRateLimits || (config && !config.hasApiRateLimits)) {
        await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: false, rateLimitsUrl: config ? config.rateLimitsUrl : "" });
        return;
      }

      const info = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CommitMG: Checking rate limits...", cancellable: false }, () =>
        client.checkRateLimits!(),
      );

      // A successful call can still come back with no headers at all (e.g. a
      // custom server that exposes none): report it as unsupported instead
      // of showing a "? / ?" usage reading.
      const hasAnyValue = Object.values(info).some((value) => value !== null && value !== undefined);
      if (!hasAnyValue) {
        await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: false, rateLimitsUrl: config ? config.rateLimitsUrl : "" });
        return;
      }

      await this.panel.webview.postMessage({ type: "rateLimitsResult", success: true, supported: true, info });
    } catch (error) {
      await this.panel.webview.postMessage({ type: "rateLimitsResult", success: false, supported: true, message: extractAiErrorMessage(error) });
    }
  }

  // Measures the prompt token count for every commit style against the first
  // Git repository in the workspace and posts a cost-comparison table back.
  // Provider-independent by design: the pricing table in estimatePromptCost.ts
  // is a fixed benchmark set, and no API key or network call is involved.
  private async handleEstimateCost(): Promise<void> {
    try {
      const repoRoot = findGitRepoRoot();
      if (!repoRoot) {
        await this.panel.webview.postMessage({ type: "costEstimateResult", success: false, message: "Open a Git repository workspace first to estimate prompt cost." });
        return;
      }

      const styles: CostEstimateStyleRow[] = [];
      for (const style of COMMIT_STYLES) {
        const recorder = new RecordingAiClient();
        await generateCommitMessage(repoRoot, style, recorder, undefined, { options: readRunSettings().options });
        const first = recorder.calls[0];
        if (!first) {
          throw new Error(`Prompt measurement failed for the ${style} style.`);
        }
        styles.push({
          style,
          systemTokens: countPromptTokens(first.systemPrompt),
          userTokens: countPromptTokens(first.userPrompt),
          estOutputTokens: ESTIMATED_OUTPUT_TOKENS[style],
        });
      }

      const result: CostEstimateResult = {
        repoPath: repoRoot,
        styles,
        models: buildModelCostRows(styles),
        retrievedAt: PRICING_RETRIEVED_AT,
      };
      await this.panel.webview.postMessage({ type: "costEstimateResult", success: true, result });
    } catch (error) {
      const message = extractAiErrorMessage(error);
      const friendlyMessage =
        message === NO_CHANGES_ERROR
          ? `${message} This estimate measures the prompt built from the changes currently in the workspace repository: stage or create some changes first, then run Estimate Cost again.`
          : message;
      await this.panel.webview.postMessage({ type: "costEstimateResult", success: false, message: friendlyMessage });
    }
  }

  // Builds the exact prompt a generation would send for the workspace
  // repository's current changes with the current settings, and reports its
  // size. Nothing is sent to any provider. The request id is echoed back so
  // the tab can drop a result that a newer request has replaced.
  private async handleMeasurePromptSize(requestId: number): Promise<void> {
    const reply = (result: Record<string, unknown>) => this.panel.webview.postMessage({ type: "promptSizeResult", requestId, ...result });
    const repoRoot = findGitRepoRoot();
    if (!repoRoot) {
      await reply({ success: false, message: "open a Git repository first." });
      return;
    }
    try {
      const { systemPrompt, userPrompt } = await buildPromptForRepo(repoRoot, PROMPT_SIZE_STYLE, readRunSettings().options);
      await reply({
        success: true,
        tokens: countPromptTokens(systemPrompt) + countPromptTokens(userPrompt),
        chars: systemPrompt.length + userPrompt.length,
        style: PROMPT_SIZE_STYLE,
        repoName: path.basename(repoRoot),
      });
    } catch (error) {
      const message = extractAiErrorMessage(error);
      await reply({ success: false, message: message === NO_CHANGES_ERROR ? "there are no changes to measure yet." : message });
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
      userSettings: readUserSettingsView(),
      speedEffective: readRunSettings().options,
      speedLimits: SPEED_LIMITS,
      modelSupport: settings.pathway === "direct" ? supportFor(settings.providerName, settings.modelId || defaultModelFor(settings.providerName)) : null,
      rules: await readRulesView(findGitRepoRoot()),
    };

    await this.panel.webview.postMessage({ type: "state", state });
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const extensionUri = this.context.extensionUri;
    const mediaUri = (...segments: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", ...segments));
    const styleUri = mediaUri("settings.css");
    const componentStyleUri = mediaUri("components", "components.css");
    const nonce = getNonce();
    // Load order matters: the logic bundle and the shared helpers first,
    // then the components, then the tab code that uses them all.
    const scriptUris = [
      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "settingsLogic.js")),
      mediaUri("tooltip.js"),
      mediaUri("customSelect.js"),
      mediaUri("icons.js"),
      ...WEBVIEW_COMPONENTS.map((name) => mediaUri("components", `${name}.js`)),
      ...WEBVIEW_TABS.map((name) => mediaUri("tabs", `${name}.js`)),
      mediaUri("settingsMain.js"),
    ];
    const scriptTags = scriptUris.map((uri) => `<script nonce="${nonce}" src="${uri}"></script>`).join("\n  ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${componentStyleUri}" rel="stylesheet">
  <title>CommitMG Settings</title>
</head>
<body>
  <div id="app">
    <header class="settings-header">
      <h1>CommitMG Settings</h1>
    </header>

    <section class="tabs-section tabs-centered">
      <!-- Tab buttons are built from the TABS registry in settingsMain.js. -->
      <div id="tab-bar" class="tabs" role="tablist"></div>
    </section>

    <!-- The active tab renders its markup here. -->
    <section id="tab-content" class="card" role="tabpanel"></section>
  </div>

  <div id="ai-setup-help-modal" class="modal" data-dismiss-on-outside-click="true" hidden></div>

  <!-- Single shared modal for connection tests, rate limits, and fetch
       errors. Persistent in the page shell, toggled via the hidden
       attribute; kind (success/error/info) colors only the title icon and
       the text, never the card chrome. -->
  <div id="message-modal" class="modal" data-dismiss-on-outside-click="true" hidden>
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

  <!-- Dedicated modal for the Estimate Cost report. Unlike the shared
       message modal it has no OK button (its close X suffices), a fixed
       chartBar title icon, and a wide card. The webview fills its body with
       a loading spinner first, then with the report tables when the host
       responds. Outside presses must not dismiss the report, so stray
       clicks flash the card border instead. -->
  <div id="cost-estimate-modal" class="modal" data-dismiss-on-outside-click="false" hidden>
    <div class="modal-card modal-card-wide">
      <div class="modal-header">
        <span id="cost-estimate-title" class="modal-title"></span>
        <button id="cost-estimate-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="cost-estimate-body" class="message-modal-body"></div>
    </div>
  </div>

  ${scriptTags}
</body>
</html>`;
  }
}

// The style the Speed & Context tab measures the prompt with. The settings
// change mostly the change data, which every style sends alike; Medium is
// the middle of the four in instruction size.
const PROMPT_SIZE_STYLE: CommitStyle = "medium";

// How long the panel waits after a settings change event before redrawing,
// so a burst of events from one outside edit draws once.
const STATE_POST_DELAY_MS = 50;

// The input ranges the Speed & Context tab validates against; the host
// checks the same ranges again before writing (isValidUserSettingValue).
const SPEED_LIMITS = {
  ...GENERATION_OPTION_RANGES,
  timeoutSeconds: TIMEOUT_SECONDS_RANGE,
  temperature: TEMPERATURE_RANGE,
  maxOutputTokens: MAX_OUTPUT_TOKENS_RANGE,
  defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
} as const;

function supportFor(providerName: DirectProviderName, modelId: string): ModelSupport & { modelId: string } {
  return { modelId, ...modelSupport(providerName, modelId) };
}

// The model a direct provider uses when none is stored; "custom" has none.
function defaultModelFor(providerName: DirectProviderName): string {
  return providerName === "custom" ? "" : getDefaultModelId(providerName);
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
