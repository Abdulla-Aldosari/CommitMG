/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The Speed & Context tab: how much of the change is sent (the context
// preset and its knobs) and the request limits. Mounts components from
// window.CommitMgComponents and talks to the host only through post():
//   { type: "setUserSetting", key, value }  - one user edit
//   { type: "resetUserSetting", key }       - remove it from its layer
//   { type: "measurePromptSize", requestId } - size of the prompt the
//                                              current settings build
// The host validates and stores the value, then sends a new state, which
// refresh() draws. Components never echo programmatic updates, so a refresh
// cannot loop back into a write. The host answers a measurement with a
// "promptSizeResult" message, which settingsMain.js hands to
// showPromptSize().

(function () {
  // Custom is not a size on the Fast-Thorough scale but a different kind of
  // choice, so it sits in its own group of the menu. Choosing it keeps the
  // current preset's values as the starting point.
  const PRESET_OPTIONS = [
    { value: "fast", label: "Fast", groupLabel: "Presets" },
    { value: "balanced", label: "Balanced", badgeEnd: "Recommended", groupLabel: "Presets" },
    { value: "thorough", label: "Thorough", groupLabel: "Presets" },
    { value: "custom", label: "Custom", groupLabel: "Your own values" },
  ];

  // Edits go to the layer the value comes from, and Reset removes it from
  // that layer, so a workspace value is edited and reset in the workspace.
  const SOURCE_LABELS = { user: "User", workspace: "Workspace" };
  const SOURCE_HINTS = {
    user: "Set in your user settings. Reset removes it there.",
    workspace: "Set in this workspace's .vscode/settings.json, which overrides your user settings. Changes here are saved there; Reset removes it there.",
  };

  const CONTEXT_LINE_STEPS = [0, 1, 2, 3, 5, 10].map((lines) => ({ value: lines, label: lines === 1 ? "1 line" : `${lines} lines` }));

  const REASONING_LABELS = { auto: "Auto", off: "Off", low: "Low", medium: "Medium", high: "High", max: "Max" };

  // Auto first, then the levels the chosen model offers, in order.
  const reasoningSteps = (levels) => ["auto", ...levels].map((level) => ({ value: level, label: REASONING_LABELS[level] }));

  const MEASURE_LABEL = "Measure again";
  const NO_REPO_MESSAGE = "Prompt size is measured on the changes in the working tree. Open a repository and make some changes to see the expected prompt size.";

  const controlId = (key) => `speed-${key.replace(/\W/g, "-")}`;

  function createSpeedTab(post) {
    const c = window.CommitMgComponents;
    // Mounted controls and their setting rows, by setting key.
    let controls = {};
    let rows = {};
    let modelBanner = null;
    // The prompt size line: the options it was measured for, and the id of
    // the latest request, so an older result never overwrites a newer one.
    let sizeBanner = null;
    let sizeKey = null;
    // Read once from the first state: opening another folder reloads the
    // window, so it cannot change while the panel is open.
    let hasRepo = false;
    let sizeRequestId = 0;
    let advancedOpen = false;

    // The preset and the five settings it controls sit together in one
    // framed group; everything after the group is independent of it.
    const render = () => `
      <h2>Speed &amp; Context</h2>
      <p class="tab-intro">Bigger prompts give the model more of the change to read, but take longer and cost more.</p>
      <h3 class="tab-section-title" id="speed-preset-group-title">Context size</h3>
      <section class="setting-group" aria-labelledby="speed-preset-group-title">
        <div id="speed-preset-row"></div>
        <div id="speed-prompt-size"></div>
        <p class="setting-group-note">The settings in this box follow the preset. Changing one of them switches the preset to Custom and keeps the others as they are.</p>
        <div id="speed-evidence-row"></div>
        <div id="speed-evidence-budget-row"></div>
        <div id="speed-diff-budget-row"></div>
        <div id="speed-context-lines-row"></div>
        <div id="speed-type-guide-row"></div>
      </section>
      <h3 class="tab-section-title">Diff filters</h3>
      <div id="speed-whitespace-row"></div>
      <div id="speed-exclude-row"></div>
      <h3 class="tab-section-title">Requests</h3>
      <div id="speed-autocorrect-row"></div>
      <div id="speed-timeout-row"></div>
      <h3 class="tab-section-title">Model</h3>
      <div id="speed-model-banner"></div>
      <div id="speed-reasoning-row"></div>
      <div id="speed-temperature-row"></div>
      <div id="speed-max-tokens-row"></div>
      <div id="speed-advanced"></div>`;

    const send = (key, value) => post({ type: "setUserSetting", key, value });

    // Asks the host to measure the prompt the current settings produce.
    function measurePromptSize() {
      if (!hasRepo) {
        return;
      }
      sizeRequestId++;
      drawSize({ kind: "info", message: "Measuring the prompt for the current changes...", action: { label: MEASURE_LABEL, onClick: measurePromptSize, disabled: true } });
      post({ type: "measurePromptSize", requestId: sizeRequestId });
    }

    // With a repository the banner keeps a fixed height and a visible button,
    // so a new result never moves what follows. Without one there is nothing
    // to measure, so it shows a short description and a disabled button.
    function drawSize(config) {
      sizeBanner.update({ ...config, reserve: hasRepo });
    }

    function showNoRepoSize() {
      drawSize({ kind: "info", message: NO_REPO_MESSAGE, action: { label: MEASURE_LABEL, onClick: measurePromptSize, disabled: true } });
    }

    // Draws the host's measurement unless a newer request is on its way.
    function showPromptSize(result) {
      if (!sizeBanner || result.requestId !== sizeRequestId) {
        return;
      }
      const view = window.CommitMgSettingsLogic.promptSizeView(result);
      drawSize({ ...view, action: { label: MEASURE_LABEL, onClick: measurePromptSize, disabled: false } });
    }

    function mountRow(container, key, config) {
      const row = c.createSettingRow(container, { id: controlId(key), onReset: () => post({ type: "resetUserSetting", key }), ...config });
      rows[key] = row;
      return row;
    }

    function mountToggle(container, key, config) {
      const row = mountRow(container, key, config);
      const button = document.createElement("button");
      row.control.append(button);
      controls[key] = c.createToggleSwitch(button, { labelledBy: row.titleId, onChange: (checked) => send(key, checked) });
    }

    function mountNumber(parent, key, limits, config) {
      const holder = document.createElement("div");
      parent.append(holder);
      const row = mountRow(holder, key, config);
      controls[key] = c.createNumberField(row.control, {
        id: `${controlId(key)}-input`,
        min: limits.min,
        max: limits.max,
        integer: config.integer !== false,
        allowEmpty: config.allowEmpty === true,
        placeholder: config.placeholder,
        unit: config.unit,
        onChange: (value) => send(key, value),
      });
    }

    function mountModelSection(limits) {
      modelBanner = c.createInfoBanner(document.getElementById("speed-model-banner"), { message: "" });

      const reasoningRow = mountRow(document.getElementById("speed-reasoning-row"), "model.reasoning", {
        title: "Reasoning",
        description: "How much the model thinks before answering. More thinking can choose types and scopes better, but takes longer.",
        layout: "stacked",
      });
      controls["model.reasoning"] = c.createStepSlider(reasoningRow.control, {
        title: "Effort",
        values: reasoningSteps([]),
        value: "auto",
        commitOnRelease: true,
        onChange: (value) => send("model.reasoning", value),
      });

      mountNumber(document.getElementById("speed-temperature-row"), "model.temperature", limits.temperature, {
        title: "Temperature",
        description: "Lower is more predictable. Empty uses CommitMG's default (0.2) where the model accepts one.",
        integer: false,
        allowEmpty: true,
        placeholder: "Auto",
      });

      mountNumber(document.getElementById("speed-max-tokens-row"), "model.maxOutputTokens", limits.maxOutputTokens, {
        title: "Maximum output",
        description: `The most the model may write, reasoning included. Empty uses ${limits.defaultMaxOutputTokens.toLocaleString("en-US")}.`,
        allowEmpty: true,
        placeholder: "Auto",
        unit: "tokens",
      });
    }

    // Shows what the chosen model really receives: only its reasoning
    // levels are offered, and a setting it ignores is marked as such.
    function refreshModelSection(state) {
      const speed = state.userSettings;
      const support = state.modelSupport;
      const logic = window.CommitMgSettingsLogic;
      const reasoning = logic.reasoningView(speed["model.reasoning"].value, support ? support.reasoningLevels : []);

      controls["model.reasoning"].setValues(reasoningSteps(support ? support.reasoningLevels : []), reasoning.value, null);
      controls["model.reasoning"].setDisabled(!support || support.reasoningLevels.length === 0);
      controls["model.temperature"].setValue(speed["model.temperature"].value);
      controls["model.maxOutputTokens"].setValue(speed["model.maxOutputTokens"].value);

      for (const key of ["model.reasoning", "model.temperature", "model.maxOutputTokens"]) {
        rows[key].setDisabled(!support);
      }
      controls["model.temperature"].setDisabled(!support);
      controls["model.maxOutputTokens"].setDisabled(!support);

      rows["model.reasoning"].setSupport(
        reasoning.ignoredLevel ? "unsupported" : support && support.reasoningLevels.length === 0 ? "unsupported" : "supported",
        reasoning.ignoredLevel ? `This model does not offer "${REASONING_LABELS[reasoning.ignoredLevel]}", so it uses its own default.` : "This model has no reasoning setting.",
      );
      const temperature = support ? support.temperature : "supported";
      rows["model.temperature"].setSupport(
        temperature === "unsupported" ? "unsupported" : temperature === "onlyWhenReasoningOff" ? "partial" : "supported",
        temperature === "unsupported" ? "This model accepts only its own temperature; the value is not sent." : "Sent only while reasoning is off.",
      );

      if (!support) {
        modelBanner.update({ kind: "info", message: "GitHub Copilot Chat models choose these values themselves; the settings apply to direct providers." });
      } else if (!support.known) {
        modelBanner.update({
          kind: "warning",
          message: `CommitMG has no capability data for "${support.modelId}", so only parameters every model of this provider accepts are sent. Pick a listed model to unlock the rest.`,
        });
      } else {
        modelBanner.update({ message: "" });
      }
    }

    function bind(state) {
      controls = {};
      rows = {};
      const limits = state.speedLimits;

      const presetRow = mountRow(document.getElementById("speed-preset-row"), "context.preset", {
        title: "Preset",
        description: "Fast sends the least, Thorough the most. Custom uses your own values.",
      });
      controls["context.preset"] = c.createDropdown(presetRow.control, {
        id: controlId("context.preset"),
        labelledBy: presetRow.titleId,
        options: PRESET_OPTIONS,
        value: "balanced",
        onChange: (value) => send("context.preset", value),
      });
      hasRepo = state.hasRepo;
      sizeBanner = c.createInfoBanner(document.getElementById("speed-prompt-size"), { message: "" });
      sizeKey = null;
      if (!hasRepo) {
        showNoRepoSize();
      }

      mountToggle(document.getElementById("speed-evidence-row"), "context.includeEvidence", {
        title: "Include old file content",
        description: "Sends the committed version of each changed file, so the model sees what the change replaced.",
      });
      mountNumber(document.getElementById("speed-evidence-budget-row"), "context.evidenceBudget", limits.evidenceBudget, {
        title: "Old file content budget",
        description: "Total characters of old file content, across all files.",
        unit: "chars",
      });
      mountNumber(document.getElementById("speed-diff-budget-row"), "context.diffBudget", limits.diffBudget, {
        title: "Diff budget",
        description: "Characters of the diff sent to the model, shared fairly across the changed files.",
        unit: "chars",
      });

      const linesRow = mountRow(document.getElementById("speed-context-lines-row"), "context.diffContextLines", {
        title: "Lines around each change",
        description: "Unchanged lines shown before and after every change in the diff.",
        layout: "stacked",
      });
      controls["context.diffContextLines"] = c.createStepSlider(linesRow.control, {
        title: "Context",
        values: CONTEXT_LINE_STEPS,
        value: 3,
        commitOnRelease: true,
        onChange: (value) => send("context.diffContextLines", value),
      });

      mountToggle(document.getElementById("speed-whitespace-row"), "context.ignoreWhitespace", {
        title: "Ignore whitespace changes",
        description: "Leaves re-indentation and trailing spaces out of the diff. A change that is only whitespace is still sent.",
      });

      const excludeRow = mountRow(document.getElementById("speed-exclude-row"), "context.excludePatterns", {
        title: "Files left out of the diff",
        description: "Lockfiles and generated code say little about a change. Matching files are still named in the summary.",
        layout: "stacked",
      });
      controls["context.excludePatterns"] = c.createChipList(excludeRow.control, {
        id: `${controlId("context.excludePatterns")}-input`,
        label: "Excluded file patterns",
        placeholder: "Add a pattern, e.g. **/*.snap",
        validate: (text, items) => window.CommitMgSettingsLogic.addPatternProblem(text, items),
        onChange: (items) => send("context.excludePatterns", items),
      });

      const guideRow = mountRow(document.getElementById("speed-type-guide-row"), "prompt.typeGuide", {
        title: "Commit type guide",
        description: "Full explains each commit type in a paragraph; Compact uses one line each and saves about 1,500 tokens per request.",
      });
      controls["prompt.typeGuide"] = c.createSegmentedControl(guideRow.control, {
        labelledBy: guideRow.titleId,
        options: [
          { value: "full", label: "Full" },
          { value: "compact", label: "Compact" },
        ],
        value: "compact",
        onChange: (value) => send("prompt.typeGuide", value),
      });

      mountToggle(document.getElementById("speed-autocorrect-row"), "generation.autoCorrect", {
        title: "Fix rule violations automatically",
        description: "When a message breaks a rule, ask the model once to fix it. Off saves the second request; you fix the message by hand.",
      });

      mountNumber(document.getElementById("speed-timeout-row"), "generation.timeoutSeconds", limits.timeoutSeconds, {
        title: "Request timeout",
        description: "How long to wait for each answer. Reasoning models can need more time on large changes.",
        unit: "seconds",
      });

      mountModelSection(limits);

      const advanced = c.createCollapsibleSection(document.getElementById("speed-advanced"), {
        title: "Advanced",
        open: advancedOpen,
        onToggle: (open) => {
          advancedOpen = open;
        },
      });
      mountNumber(advanced.body, "context.untrackedMaxFiles", limits.untrackedMaxFiles, {
        title: "New files sent",
        description: "When nothing is staged, the content of up to this many new files is sent.",
        unit: "files",
      });
      mountNumber(advanced.body, "context.untrackedMaxBytes", limits.untrackedMaxBytes, {
        title: "New file content",
        description: "Total size of new file content sent when nothing is staged.",
        unit: "bytes",
      });

      refresh(state);
    }

    // Draws every control from the state. Preset knobs show the values the
    // next generation really uses (state.speedEffective), so a named preset
    // displays its own numbers rather than the stored custom ones.
    function refresh(state) {
      const speed = state.userSettings;
      const effective = state.speedEffective;
      const preset = speed["context.preset"].value;

      controls["context.preset"].setValue(preset);
      // Measure again only when a setting that shapes the prompt changed.
      const nextSizeKey = window.CommitMgSettingsLogic.promptSizeKey(effective);
      if (nextSizeKey !== sizeKey) {
        sizeKey = nextSizeKey;
        measurePromptSize();
      }

      controls["context.includeEvidence"].setChecked(effective.includeEvidence);
      controls["context.diffContextLines"].setValue(effective.diffContextLines);
      controls["context.ignoreWhitespace"].setChecked(effective.ignoreWhitespace);
      controls["context.excludePatterns"].setItems(effective.excludePatterns);
      controls["prompt.typeGuide"].setValue(effective.typeGuide);
      controls["generation.autoCorrect"].setChecked(speed["generation.autoCorrect"].value !== false);
      controls["generation.timeoutSeconds"].setValue(speed["generation.timeoutSeconds"].value);
      refreshModelSection(state);
      controls["context.evidenceBudget"].setValue(effective.evidenceBudget);
      controls["context.evidenceBudget"].setDisabled(!effective.includeEvidence);
      controls["context.diffBudget"].setValue(effective.diffBudget);
      controls["context.untrackedMaxFiles"].setValue(effective.untrackedMaxFiles);
      controls["context.untrackedMaxBytes"].setValue(effective.untrackedMaxBytes);

      for (const [key, row] of Object.entries(rows)) {
        const source = speed[key].source;
        row.setSource(SOURCE_LABELS[source] || null, SOURCE_HINTS[source]);
        row.setResettable(source !== "default");
      }
    }

    return { id: "speed", label: "Speed & Context", render, bind, refresh, showPromptSize };
  }

  window.CommitMgTabs = window.CommitMgTabs || {};
  window.CommitMgTabs.createSpeedTab = createSpeedTab;
})();
