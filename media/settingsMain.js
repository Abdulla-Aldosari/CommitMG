/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Client-side logic for the CommitMG Settings webview panel. Renders the
// unified provider dropdown (renderCustomSelect/bindCustomSelect, from
// media/customSelect.js) with three visual groups - Direct API / VS Code
// Language Model / Custom - via the groupLabel field, a colored key badge
// per provider (media/icons.js, RunBox's cs-key-badge pattern), and a
// localStorage model cache with a 7-day TTL (ported from RunBox's
// media/modals/ai-settings.js): switching providers uses the cache when
// fresh, falling back to a single-provider fetch; the "Refresh" button
// refreshes every provider that has a saved key (plus "custom" when it has
// a base URL, plus the vscode pathway) in one batch.

(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let state = null;
  let modelsLoading = false;
  let loadingKey = null;

  // ─── Tab shell (static #app chrome lives in settingsPanel.ts's HTML;
  // each tab's own markup is rendered here into #tab-content) ─────────────

  function renderAiSettingsTab() {
    return `
      <h2>AI Settings</h2>
      <div class="field">
        <label>AI Provider</label>
        <div id="pathway-select-container"></div>
      </div>
      <div id="direct-section" hidden>
        <div class="field" id="custom-base-url-field" hidden>
          <label>Base URL</label>
          <input type="text" id="custom-base-url" placeholder="https://your-server/v1">
        </div>
        <div class="field">
          <label>Model</label>
          <div id="model-select-container" class="cs-wrap-full"></div>
        </div>
        <div class="field">
          <div class="row">
            <label id="api-key-label">API Key</label>
            <div class="ai-provider-key-status-item" id="api-key-status"></div>
          </div>
          <div class="row">
            <input type="password" id="api-key-input" placeholder="Paste your API key">
            <button class="btn btn-ghost min-w60" id="btn-delete-api-key">Delete</button>
            <button class="btn btn-primary min-w60" id="btn-save-api-key">Save</button>
          </div>
          <div class="ai-secretstorage-note">Your API key is securely encrypted and stored within your operating system's native credential manager.</div>
        </div>
        <div class="ai-provider-links" id="provider-links"></div>
        <div class="row justify-content-flex-end mt-20">
          <button class="btn btn-ghost" id="btn-refresh-models">↻ Refresh models</button>
          <button class="btn btn-ghost" id="btn-check-connection" data-tooltip="Verify API key and connectivity">Check Connection</button>
          <button class="btn btn-ghost" id="btn-check-rate-limits" data-tooltip="Check current rate limit usage">Check Rate Limits</button>
        </div>
        <div class="status-line" id="status-line"></div>
      </div>
      <div id="vscode-section" hidden>
        <div class="field">
          <label>Model (from GitHub Copilot Chat)</label>
          <div id="vscode-model-select-container" class="cs-wrap-full"></div>
        </div>
        <div class="row justify-content-flex-end mt-20">
          <button class="btn btn-ghost" id="btn-refresh-vscode-models">↻ Refresh models</button>
          <button class="btn btn-ghost" id="btn-check-connection-vscode">Check Connection</button>
        </div>
        <div class="status-line" id="status-line-vscode"></div>
      </div>`;
  }

  // Maps each tab's data-tab value to the function that renders its markup
  // into #tab-content. Only "ai" exists today; adding a future tab means
  // adding one entry here plus its own `<button class="tab" ...>` markup
  // in settingsPanel.ts, without touching this dispatch mechanism.
  const TAB_RENDERERS = {
    ai: renderAiSettingsTab,
  };

  function activateTab(tabName) {
    const renderTab = TAB_RENDERERS[tabName];
    if (!renderTab) {
      return;
    }
    for (const tabBtn of document.querySelectorAll(".tab")) {
      tabBtn.classList.toggle("active", tabBtn.dataset.tab === tabName);
    }
    $("tab-content").innerHTML = renderTab();
    bindTabEventListeners();
    render();
  }

  for (const tabBtn of document.querySelectorAll(".tab")) {
    tabBtn.addEventListener("click", function () {
      activateTab(tabBtn.dataset.tab);
    });
  }

  function postMessage(message) {
    vscode.postMessage(message);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  // ─── Model Cache (localStorage, 7-day TTL) ──────────────────────────────

  const AI_MODELS_CACHE_KEY = "commitmg_ai_models_cache";
  const AI_MODELS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function getCachedModels(cacheKey) {
    try {
      const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const cache = JSON.parse(raw);
      const entry = cache[cacheKey];
      if (!entry || !entry.fetchedAt || !Array.isArray(entry.models) || !entry.models.length) {
        return null;
      }
      if (Date.now() - entry.fetchedAt > AI_MODELS_CACHE_TTL_MS) {
        return null;
      }
      return entry.models;
    } catch {
      return null;
    }
  }

  function setModelsCache(cacheKey, models) {
    try {
      const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[cacheKey] = { models, fetchedAt: Date.now() };
      localStorage.setItem(AI_MODELS_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore storage errors (e.g. disabled storage); the webview simply
      // falls back to fetching again next time.
    }
  }

  function clearModelsCache(cacheKey) {
    try {
      const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
      if (!raw) {
        return;
      }
      const cache = JSON.parse(raw);
      delete cache[cacheKey];
      localStorage.setItem(AI_MODELS_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore storage errors.
    }
  }

  function getModelsCacheFetchedAt(cacheKey) {
    try {
      const raw = localStorage.getItem(AI_MODELS_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const cache = JSON.parse(raw);
      return cache[cacheKey] ? cache[cacheKey].fetchedAt : null;
    } catch {
      return null;
    }
  }

  function formatTimeAgo(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) {
      return "just now";
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return `${diffDays}d ago`;
  }

  // ─── Selection Helpers ───────────────────────────────────────────────────

  function currentSelection() {
    if (state.pathway === "vscode") {
      return { pathway: "vscode", modelId: state.vsCodeModelId || undefined };
    }
    return {
      pathway: "direct",
      providerName: state.providerName,
      modelId: state.modelId,
      customBaseUrl: state.providerName === "custom" ? state.customBaseUrl : undefined,
    };
  }

  function cacheKeyFor(selection) {
    return selection.pathway === "vscode" ? "vscode" : selection.providerName;
  }

  function findProviderConfig(providerName) {
    return (state.providers || []).find((p) => p.name === providerName);
  }

  function hasKeyFor(providerName) {
    return Boolean(state.keyStatus && state.keyStatus[providerName]);
  }

  // Whether the buttons that require a live request (Refresh/Check
  // Connection/Check Rate Limits) should be enabled for the current
  // selection: "vscode" never needs a key; "custom" needs a base URL;
  // every other direct provider needs a saved API key.
  function canMakeRequests() {
    if (state.pathway === "vscode") {
      return true;
    }
    if (state.providerName === "custom") {
      return Boolean(state.customBaseUrl && state.customBaseUrl.trim());
    }
    return hasKeyFor(state.providerName);
  }

  // ─── Provider Dropdown (unified, grouped, with key badges) ──────────────

  function keyBadge(providerName) {
    const active = hasKeyFor(providerName);
    return `<span class="cs-key-badge ${active ? "key-active" : "key-inactive"}">${window.icons.key}</span>`;
  }

  function buildProviderOptions() {
    const options = (state.providers || []).map((p) => ({
      value: `direct:${p.name}`,
      label: p.displayLabel,
      groupLabel: "Direct API",
      badgeEnd: keyBadge(p.name),
    }));
    options.push({ value: "direct:custom", label: "Custom (OpenAI-compatible)", groupLabel: "Direct API", badgeEnd: keyBadge("custom") });
    options.push({ value: "vscode", label: "GitHub Copilot Chat", groupLabel: "VS Code Language Model" });
    return options;
  }

  function currentProviderValue() {
    return state.pathway === "vscode" ? "vscode" : `direct:${state.providerName}`;
  }

  function renderPathwaySelect() {
    const options = buildProviderOptions();
    $("pathway-select-container").innerHTML = window.renderCustomSelect(
      "pathway-select-wrap",
      "pathway-select-btn",
      "pathway-select-menu",
      options,
      currentProviderValue(),
      "",
      false,
      "cs-wrap-full",
    );
    window.bindCustomSelect("pathway-select-wrap", "pathway-select-btn", "pathway-select-menu", function (value) {
      if (value === "vscode") {
        postMessage({ type: "selectVsCodePathway" });
      } else {
        const providerName = value.slice("direct:".length);
        postMessage({ type: "selectProvider", providerName });
      }
    });
  }

  // ─── Model Dropdowns ─────────────────────────────────────────────────────

  // The single source of truth for the list shown in the model dropdown:
  // fresh fetched models from the localStorage cache when available, else
  // the provider's static fallback list, else an empty list (custom and
  // vscode before their first successful fetch). Reading from one place
  // keeps the dropdown stable across re-renders: after picking a live
  // model, the state round-trip rebuilds the dropdown from this same
  // cached list, so the selection is always found and never visually
  // reset to the default.
  function currentModelList() {
    const selection = currentSelection();
    const cached = getCachedModels(cacheKeyFor(selection));
    if (cached) {
      return cached;
    }
    if (selection.pathway === "direct") {
      const config = findProviderConfig(selection.providerName);
      if (config) {
        return config.models.map((m) => ({ modelId: m.modelId, modelLabel: m.modelLabel }));
      }
    }
    return [];
  }

  function renderModelSelect() {
    if (modelsLoading && loadingKey === state.providerName) {
      $("model-select-container").innerHTML = `<button class="btn btn-ghost cs-wrap-full" type="button" disabled>Loading models...</button>`;
      return;
    }

    const options = currentModelList().map((m) => ({ value: m.modelId, label: m.modelLabel }));
    const config = findProviderConfig(state.providerName);
    const selected = state.modelId || (config ? config.defaultModelId : "");

    $("model-select-container").innerHTML = window.renderCustomSelect("model-select-wrap", "model-select-btn", "model-select-menu", options, selected, "", false, "cs-wrap-full");
    window.bindCustomSelect("model-select-wrap", "model-select-btn", "model-select-menu", function (value) {
      postMessage({ type: "selectModel", modelId: value });
    });
  }

  function renderVsCodeModelSelect() {
    if (modelsLoading && loadingKey === "vscode") {
      $("vscode-model-select-container").innerHTML = `<button class="btn btn-ghost cs-wrap-full" type="button" disabled>Loading models...</button>`;
      return;
    }

    const options = currentModelList().map((m) => ({ value: m.modelId, label: m.modelLabel }));
    $("vscode-model-select-container").innerHTML = window.renderCustomSelect(
      "vscode-model-select-wrap",
      "vscode-model-select-btn",
      "vscode-model-select-menu",
      options,
      state.vsCodeModelId,
      "",
      false,
      "cs-wrap-full",
    );
    window.bindCustomSelect("vscode-model-select-wrap", "vscode-model-select-btn", "vscode-model-select-menu", function (value) {
      postMessage({ type: "selectVsCodeModel", modelId: value });
    });
  }

  // ─── API Key status, provider links, setup modal ────────────────────────

  function renderApiKeyStatus() {
    const hasKey = hasKeyFor(state.providerName);
    $("api-key-status").innerHTML = hasKey
      ? `${window.icons.checkboxOk}<span class="ai-key-status ai-key-ok">Key saved</span>`
      : `${window.icons.exclamationTriangle}<span class="ai-key-status ai-key-missing">No key saved</span>`;
    $("api-key-status").className = `ai-provider-key-status-item ${hasKey ? "ai-key-ok" : "ai-key-missing"}`;
    $("api-key-label").textContent = `API Key for ${state.providerName}`;
    $("btn-delete-api-key").hidden = !hasKey;
  }

  function renderProviderLinks() {
    const config = findProviderConfig(state.providerName);
    if (!config) {
      $("provider-links").innerHTML = "";
      return;
    }
    $("provider-links").innerHTML = `
      Don't have an API key?
      <div class="ai-provider-help-item">
        ${window.icons.key}
        <a class="ai-provider-link" id="btn-ai-get-api-key" data-url="${escapeAttr(config.apiKeyUrl)}" href="#" data-tooltip="Open ${escapeAttr(config.apiKeyUrlLabel)} in browser">
          Get API Key (${escapeHtml(config.apiKeyUrlLabel)})
        </a>
      </div>
      <div class="ai-provider-help-item">
        ${window.icons.aiSetupHelp}
        <a class="ai-provider-link" id="btn-ai-show-setup-help" href="#" data-tooltip="Show step-by-step instructions">
          How to get (${escapeHtml(config.apiKeyUrlLabel)}) API Key?
        </a>
      </div>`;

    $("btn-ai-get-api-key").addEventListener("click", function (e) {
      e.preventDefault();
      postMessage({ type: "openExternalUrl", url: config.apiKeyUrl });
    });
    $("btn-ai-show-setup-help").addEventListener("click", function (e) {
      e.preventDefault();
      openSetupModal(config);
    });
  }

  function openSetupModal(config) {
    const stepsHtml = config.steps
      .map((step, idx) => `<li class="ai-setup-step"><div class="ai-setup-step-number">${idx + 1}</div><div class="ai-setup-step-text">${step}</div></li>`)
      .join("");

    const modal = $("ai-setup-help-modal");
    modal.innerHTML = `
      <div class="modal-box">
        <h3>${window.icons.key} How to get API Key for <strong>${escapeHtml(config.serviceName)}</strong></h3>
        <ol class="ai-setup-steps">${stepsHtml}</ol>
        <div class="row justify-content-flex-end mt-20">
          <a class="ai-provider-link" id="btn-ai-setup-open-url" data-url="${escapeAttr(config.apiKeyUrl)}" href="#">${window.icons.externalLink} Open ${escapeHtml(config.apiKeyUrlLabel)}</a>
          <button class="btn btn-ghost" id="btn-ai-setup-close">Close</button>
        </div>
      </div>`;
    modal.hidden = false;

    function close() {
      modal.hidden = true;
      modal.innerHTML = "";
      modal.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onEscKey);
    }
    function onOverlayClick(e) {
      if (e.target === modal) {
        close();
      }
    }
    function onEscKey(e) {
      if (e.key === "Escape") {
        close();
      }
    }

    modal.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onEscKey);
    document.getElementById("btn-ai-setup-close").addEventListener("click", close);
    document.getElementById("btn-ai-setup-open-url").addEventListener("click", function (e) {
      e.preventDefault();
      postMessage({ type: "openExternalUrl", url: config.apiKeyUrl });
    });
  }

  // ─── Button enable/disable + tooltip ─────────────────────────────────────

  function updateActionButtons() {
    const enabled = canMakeRequests();
    const tooltip = enabled ? "" : "Add an API key first";

    for (const id of ["btn-check-connection", "btn-check-rate-limits", "btn-refresh-models"]) {
      const btn = $(id);
      if (!btn) {
        continue;
      }
      btn.disabled = !enabled;
      if (!enabled) {
        btn.setAttribute("data-tooltip", tooltip);
      } else {
        btn.removeAttribute("data-tooltip");
      }
    }

    const fetchedAt = getModelsCacheFetchedAt(cacheKeyFor(currentSelection()));
    const refreshBtn = $("btn-refresh-models");
    if (refreshBtn) {
      if (enabled) {
        const updatedText = fetchedAt ? `( Updated ${formatTimeAgo(fetchedAt)} )` : "";
        refreshBtn.setAttribute("data-tooltip", `Fetch latest models from each provider's API<br>(all providers with a saved key)`);
        refreshBtn.setAttribute("data-tooltip-footer", `${updatedText}`);
      } else {
        refreshBtn.removeAttribute("data-tooltip-footer");
      }
    }
  }

  // ─── Automatic model fetch on switch (cache-first) ───────────────────────

  function autoLoadModels(selection) {
    const cacheKey = cacheKeyFor(selection);
    if (getCachedModels(cacheKey)) {
      return; // render() already showed the cached list
    }
    if (modelsLoading && loadingKey === cacheKey) {
      return; // a fetch for this exact list is already in flight
    }

    const needsKey = selection.pathway === "direct" && selection.providerName !== "custom";
    const hasRequiredInput =
      selection.pathway === "vscode" ||
      (selection.pathway === "direct" && selection.providerName === "custom" ? Boolean(selection.customBaseUrl) : hasKeyFor(selection.providerName));

    if (needsKey && !hasKeyFor(selection.providerName)) {
      return;
    }
    if (!hasRequiredInput) {
      return;
    }

    modelsLoading = true;
    loadingKey = cacheKey;
    renderModelSections();
    postMessage({ type: "refreshModel", selection });
  }

  function applyModelsResult(cacheKey, models) {
    setModelsCache(cacheKey, models);
    if (cacheKey === cacheKeyFor(currentSelection())) {
      renderModelSections();
    }
  }

  function renderModelSections() {
    if (state.pathway === "direct") {
      renderModelSelect();
    } else {
      renderVsCodeModelSelect();
    }
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  function render() {
    if (!state) {
      return;
    }

    renderPathwaySelect();

    const isDirect = state.pathway === "direct";
    $("direct-section").hidden = !isDirect;
    $("vscode-section").hidden = isDirect;

    if (isDirect) {
      $("custom-base-url-field").hidden = state.providerName !== "custom";
      $("custom-base-url").value = state.customBaseUrl || "";
      renderModelSelect();
      renderApiKeyStatus();
      renderProviderLinks();
    } else {
      renderVsCodeModelSelect();
    }

    updateActionButtons();
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  let previousCacheKey = null;

  function applyState(newState) {
    state = newState;

    const selection = currentSelection();
    const newCacheKey = cacheKeyFor(selection);
    if (previousCacheKey !== newCacheKey) {
      // Provider or pathway changed: drop the in-flight loading state of
      // the previous selection before rendering the new one.
      modelsLoading = false;
      loadingKey = null;
    }
    previousCacheKey = newCacheKey;

    render();

    // Run the cache-first auto-load on every state message, not only on
    // provider switches: it is a no-op when the cache is fresh, and it
    // self-heals the cases where the cache was just cleared (API key
    // saved or deleted) or where a provider that can now make requests
    // has no list yet (custom base URL typed, first open, etc.).
    autoLoadModels(selection);
  }

  window.addEventListener("message", function (event) {
    const message = event.data;
    switch (message.type) {
      case "state":
        applyState(message.state);
        break;
      case "modelsResult": {
        const isCurrent = message.cacheKey === loadingKey;
        if (isCurrent) {
          modelsLoading = false;
          loadingKey = null;
        }
        if (message.success) {
          applyModelsResult(message.cacheKey, message.models);
        } else if (isCurrent) {
          $("status-line").textContent = message.message || "Failed to fetch models.";
          renderModelSections();
        }
        updateActionButtons();
        break;
      }
      case "saveApiKeyResult":
        $("api-key-input").value = "";
        clearModelsCache(state.providerName);
        break;
      case "connectionResult": {
        const line = state.pathway === "direct" ? $("status-line") : $("status-line-vscode");
        line.textContent = message.success ? "Connection OK." : message.message || "Connection failed.";
        line.className = `status-line ${message.success ? "ok" : "error"}`;
        break;
      }
      case "rateLimitsResult": {
        const line = $("status-line");
        if (!message.supported) {
          line.textContent = "This provider does not expose rate-limit info.";
          line.className = "status-line";
        } else if (message.success) {
          line.textContent = `Requests: ${message.info.remainingRequests ?? "?"}/${message.info.limitRequests ?? "?"}  Tokens: ${message.info.remainingTokens ?? "?"}/${message.info.limitTokens ?? "?"}`;
          line.className = "status-line ok";
        } else {
          line.textContent = message.message || "Failed to check rate limits.";
          line.className = "status-line error";
        }
        break;
      }
    }
  });

  // ─── Tab content event binding dispatch ──────────────────────────────────
  // Each tab's interactive elements only exist in the DOM once its markup
  // has been injected into #tab-content, so their listeners are bound from
  // here (via TAB_BINDERS) rather than at script top-level.

  function bindAiTabEventListeners() {
    $("btn-refresh-models").addEventListener("click", function () {
      if (!canMakeRequests()) {
        return;
      }
      postMessage({ type: "refreshAllModels" });
    });
    $("btn-refresh-vscode-models").addEventListener("click", function () {
      postMessage({ type: "refreshAllModels" });
    });
    $("btn-save-api-key").addEventListener("click", function () {
      const apiKey = $("api-key-input").value.trim();
      if (apiKey) {
        postMessage({ type: "saveApiKey", providerName: state.providerName, apiKey });
      }
    });
    $("btn-delete-api-key").addEventListener("click", function () {
      clearModelsCache(state.providerName);
      postMessage({ type: "deleteApiKey", providerName: state.providerName });
    });
    $("btn-check-connection").addEventListener("click", function () {
      if (!canMakeRequests()) {
        return;
      }
      postMessage({ type: "checkConnection" });
    });
    $("btn-check-connection-vscode").addEventListener("click", function () {
      postMessage({ type: "checkConnection" });
    });
    $("btn-check-rate-limits").addEventListener("click", function () {
      if (!canMakeRequests()) {
        return;
      }
      postMessage({ type: "checkRateLimits" });
    });
    $("custom-base-url").addEventListener("change", function () {
      const url = $("custom-base-url").value.trim();
      postMessage({ type: "setCustomBaseUrl", url });
      // A plausible URL with no cached/loaded models yet: fetch
      // automatically, the same way switching to a provider with a saved
      // key does.
      if (/^https?:\/\/.+/i.test(url)) {
        state.customBaseUrl = url;
        autoLoadModels(currentSelection());
        updateActionButtons();
      }
    });
  }

  const TAB_BINDERS = {
    ai: bindAiTabEventListeners,
  };

  function bindTabEventListeners() {
    const activeTabBtn = document.querySelector(".tab.active");
    const tabName = activeTabBtn ? activeTabBtn.dataset.tab : "ai";
    const bind = TAB_BINDERS[tabName];
    if (bind) {
      bind();
    }
  }

  // Render the initially-active tab's markup into #tab-content (the HTML
  // shell emitted by settingsPanel.ts leaves it empty) and wire its
  // listeners before announcing readiness to the extension host.
  activateTab("ai");

  postMessage({ type: "ready" });
})();
