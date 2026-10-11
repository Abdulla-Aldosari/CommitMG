/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The Speed & Context tab: how much of the change is sent (the context
// preset and its knobs) and the request limits. Mounts components from
// window.CommitMgComponents and talks to the host only through post():
//   { type: "setSpeedSetting", key, value }  - one user edit
//   { type: "resetSpeedSetting", key }       - back to the default
// The host validates and stores the value, then sends a new state, which
// refresh() draws. Components never echo programmatic updates, so a refresh
// cannot loop back into a write.

(function () {
  // Custom is the last step: choosing it keeps the current preset's values
  // and unlocks them for editing.
  const PRESET_STEPS = [
    { value: "fast", label: "Fast" },
    { value: "balanced", label: "Balanced" },
    { value: "thorough", label: "Thorough" },
    { value: "custom", label: "Custom" },
  ];

  const SOURCE_LABELS = { user: "User", workspace: "Workspace", workspaceFolder: "Folder" };
  const SOURCE_HINTS = {
    user: "Set in your user settings.",
    workspace: "Set in this workspace's .vscode/settings.json; it overrides your user value.",
    workspaceFolder: "Set in this folder's .vscode/settings.json; it overrides your user value.",
  };

  const CONTEXT_LINE_STEPS = [0, 1, 2, 3, 5, 10].map((lines) => ({ value: lines, label: lines === 1 ? "1 line" : `${lines} lines` }));

  const controlId = (key) => `speed-${key.replace(/\W/g, "-")}`;

  function createSpeedTab(post) {
    const c = window.CommitMgComponents;
    // Mounted controls and their setting rows, by setting key.
    let controls = {};
    let rows = {};
    let customBanner = null;
    let advancedOpen = false;

    const render = () => `
      <h2>Speed &amp; Context</h2>
      <p class="tab-intro">Bigger prompts give the model more of the change to read, but take longer and cost more.</p>
      <div id="speed-preset-row"></div>
      <div id="speed-custom-banner"></div>
      <div id="speed-evidence-row"></div>
      <div id="speed-context-lines-row"></div>
      <div id="speed-whitespace-row"></div>
      <div id="speed-exclude-row"></div>
      <div id="speed-advanced"></div>`;

    const send = (key, value) => post({ type: "setSpeedSetting", key, value });

    function mountRow(container, key, config) {
      const row = c.createSettingRow(container, { id: controlId(key), onReset: () => post({ type: "resetSpeedSetting", key }), ...config });
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
        unit: config.unit,
        onChange: (value) => send(key, value),
      });
    }

    function bind(state) {
      controls = {};
      rows = {};
      const limits = state.speedLimits;

      const presetRow = mountRow(document.getElementById("speed-preset-row"), "context.preset", {
        title: "Context size",
        description: "Fast sends the least, Thorough the most. Editing a setting below switches to Custom.",
        layout: "stacked",
      });
      controls["context.preset"] = c.createStepSlider(presetRow.control, {
        title: "Preset",
        values: PRESET_STEPS,
        value: "balanced",
        recommended: "balanced",
        commitOnRelease: true,
        onChange: (value) => send("context.preset", value),
      });

      customBanner = c.createInfoBanner(document.getElementById("speed-custom-banner"), { message: "" });

      mountToggle(document.getElementById("speed-evidence-row"), "context.includeEvidence", {
        title: "Include old file content",
        description: "Sends the committed version of each changed file, so the model sees what the change replaced.",
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

      const advanced = c.createCollapsibleSection(document.getElementById("speed-advanced"), {
        title: "Advanced",
        open: advancedOpen,
        onToggle: (open) => {
          advancedOpen = open;
        },
      });
      mountNumber(advanced.body, "context.evidenceBudget", limits.evidenceBudget, {
        title: "Old file content budget",
        description: "Total characters of old file content, across all files.",
        unit: "chars",
      });
      mountNumber(advanced.body, "context.diffBudget", limits.diffBudget, {
        title: "Diff budget",
        description: "Characters of the diff sent to the model; longer diffs are cut.",
        unit: "chars",
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
      const speed = state.speed;
      const effective = state.speedEffective;
      const preset = speed["context.preset"].value;

      controls["context.preset"].setValue(preset);
      customBanner.update({ kind: "info", message: preset === "custom" ? "Custom: the values below are yours. Pick a preset to replace them." : "" });

      controls["context.includeEvidence"].setChecked(effective.includeEvidence);
      controls["context.diffContextLines"].setValue(effective.diffContextLines);
      controls["context.ignoreWhitespace"].setChecked(effective.ignoreWhitespace);
      controls["context.excludePatterns"].setItems(effective.excludePatterns);
      controls["context.evidenceBudget"].setValue(effective.evidenceBudget);
      controls["context.evidenceBudget"].setDisabled(!effective.includeEvidence);
      controls["context.diffBudget"].setValue(effective.diffBudget);
      controls["context.untrackedMaxFiles"].setValue(effective.untrackedMaxFiles);
      controls["context.untrackedMaxBytes"].setValue(effective.untrackedMaxBytes);

      for (const [key, row] of Object.entries(rows)) {
        const source = speed[key].source;
        row.setSource(SOURCE_LABELS[source] || null, SOURCE_HINTS[source]);
        row.setResettable(source === "user");
      }
    }

    return { id: "speed", label: "Speed & Context", render, bind, refresh };
  }

  window.CommitMgTabs = window.CommitMgTabs || {};
  window.CommitMgTabs.createSpeedTab = createSpeedTab;
})();
