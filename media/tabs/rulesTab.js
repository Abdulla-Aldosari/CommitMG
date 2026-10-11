/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The Rules tab: the commit rules of the open repository (allowed types,
// length limits, scopes), from the one active source. A banner names the
// source. Rules from .commitmgrc.json are edited here and saved to that
// file; rules from commitlint are shown read-only, since they live in the
// commitlint config. Talks to the host only through post():
//   { type: "setRulesField", field, value } - one edit; null removes it
//   { type: "createRulesFile" }             - write the defaults to a file
//   { type: "openRulesSource" }             - open the file behind the rules
// The host validates and writes the file, then sends a new state, which
// refresh() draws.

(function () {
  const FIELD_IDS = { types: "rules-types", headerMaxLength: "rules-header", bodyMaxLineLength: "rules-body", scopePolicy: "rules-scope-policy", scopes: "rules-scopes" };
  const SCOPE_POLICY_OPTIONS = [
    { value: "required", label: "Required", tooltip: "Every header has a scope." },
    { value: "optional", label: "Optional", tooltip: "A scope is used when one fits." },
    { value: "none", label: "None", tooltip: "Headers never have a scope." },
  ];
  const BULLET_SPACING_KEY = "format.bulletSpacing";
  const SOURCE_LABELS = { user: "User", workspace: "Workspace" };
  const SOURCE_HINTS = {
    user: "Set in your user settings. Reset removes it there.",
    workspace: "Set in this workspace's .vscode/settings.json, which overrides your user settings. Changes here are saved there; Reset removes it there.",
  };
  const SCOPE_COLUMNS = [
    { key: "name", label: "Scope", placeholder: "auth", width: "22%" },
    { key: "description", label: "Description", placeholder: "login and sessions", width: "38%" },
    { key: "files", label: "Files (comma-separated)", placeholder: "src/auth/, src/login.ts" },
  ];

  function createRulesTab(post) {
    const c = window.CommitMgComponents;
    const logic = () => window.CommitMgSettingsLogic;
    let controls = {};
    let rows = {};
    let banner = null;
    let current = null;
    let spacingRow = null;

    const render = () => `
      <h2>Rules</h2>
      <p class="tab-intro">The rules every generated message follows. They come from one place: the project's commitlint config, else .commitmgrc.json, else the built-in rules.</p>
      <div id="rules-source-banner"></div>
      <h3 class="tab-section-title">Types and lengths</h3>
      <div id="rules-types-row"></div>
      <div id="rules-header-row"></div>
      <div id="rules-body-row"></div>
      <h3 class="tab-section-title">Scopes</h3>
      <div id="rules-scope-policy-row"></div>
      <div id="rules-scopes-row"></div>
      <h3 class="tab-section-title">Your layout</h3>
      <p class="tab-intro">Saved in your VS Code settings, not in the project, so it applies to every repository you work in.</p>
      <div id="rules-bullet-spacing-row"></div>`;

    const send = (field, value) => post({ type: "setRulesField", field, value });

    function mountRow(id, field, config) {
      const row = c.createSettingRow(document.getElementById(id), { id: FIELD_IDS[field], onReset: () => send(field, null), ...config });
      rows[field] = row;
      return row;
    }

    function mountLimit(id, field, range, config) {
      const row = mountRow(id, field, config);
      controls[field] = c.createNumberField(row.control, {
        id: `${FIELD_IDS[field]}-input`,
        min: range.min,
        max: range.max,
        integer: true,
        unit: "chars",
        onChange: (value) => send(field, value),
      });
    }

    function bind(state) {
      controls = {};
      rows = {};
      const rules = state.rules;
      banner = c.createInfoBanner(document.getElementById("rules-source-banner"), { message: "" });

      const typesRow = mountRow("rules-types-row", "types", {
        title: "Allowed types",
        description: "The commit types a header may use. The type guide explains the standard ones; a type of your own is listed without an explanation.",
        layout: "stacked",
      });
      controls.types = c.createChipList(typesRow.control, {
        id: `${FIELD_IDS.types}-input`,
        label: "Allowed commit types",
        placeholder: "Add a type, e.g. i18n",
        validate: (text, items) => logic().addTypeProblem(text, items),
        onChange: (items) => {
          if (items.length > 0) {
            send("types", items);
          } else {
            // An empty list allows nothing, so it is never saved.
            controls.types.setItems(current.types);
          }
        },
      });

      mountLimit("rules-header-row", "headerMaxLength", rules.limitRange, {
        title: "Header length",
        description: "Most characters in the first line. The prompt's length examples are chosen from this limit.",
      });
      mountLimit("rules-body-row", "bodyMaxLineLength", rules.limitRange, {
        title: "Body line length",
        description: "Most characters in each body line; longer lines are wrapped with a two-space indent.",
      });

      const policyRow = mountRow("rules-scope-policy-row", "scopePolicy", {
        title: "Scope in the header",
        description: "Required always adds a scope, Optional adds one when it fits, None never does. None needs an empty scope list.",
      });
      controls.scopePolicy = c.createSegmentedControl(policyRow.control, {
        labelledBy: policyRow.titleId,
        options: SCOPE_POLICY_OPTIONS,
        value: rules.scopePolicy,
        onChange: (value) => send("scopePolicy", value),
      });

      const scopesRow = mountRow("rules-scopes-row", "scopes", {
        title: "Scopes",
        description:
          "With scopes listed, a header may only use one of them. Files map a change to its scope; a path ending in / covers a folder. A name starting with - is internal and never used for generated messages.",
        layout: "stacked",
      });
      controls.scopes = c.createEditableTable(scopesRow.control, {
        id: FIELD_IDS.scopes,
        label: "Scopes",
        columns: SCOPE_COLUMNS,
        addLabel: "Add scope",
        emptyText: "No scopes listed, so any scope is accepted.",
        rowName: (row, index) => (row.name ? `scope ${row.name}` : `scope row ${index + 1}`),
        validate: (tableRows) => logic().scopeRowsProblems(tableRows),
        onChange: (tableRows) => send("scopes", logic().rowsToScopes(tableRows)),
      });

      // A VS Code setting, written through the same messages as the Speed
      // & Context settings.
      spacingRow = c.createSettingRow(document.getElementById("rules-bullet-spacing-row"), {
        id: "rules-bullet-spacing",
        title: "Space between bullet points",
        description: "Blank puts one empty line between body bullet points; Compact puts them on consecutive lines.",
        onReset: () => post({ type: "resetUserSetting", key: BULLET_SPACING_KEY }),
      });
      controls.bulletSpacing = c.createSegmentedControl(spacingRow.control, {
        labelledBy: spacingRow.titleId,
        options: [
          { value: "blank", label: "Blank line" },
          { value: "compact", label: "Compact" },
        ],
        value: "blank",
        onChange: (value) => post({ type: "setUserSetting", key: BULLET_SPACING_KEY, value }),
      });

      refresh(state);
    }

    function bannerAction(action) {
      if (action === "open") {
        return { label: "Open file", onClick: () => post({ type: "openRulesSource" }) };
      }
      if (action === "create") {
        return { label: "Create .commitmgrc.json", onClick: () => post({ type: "createRulesFile" }) };
      }
      return null;
    }

    function refresh(state) {
      const rules = state.rules;
      current = rules;
      const view = logic().rulesSourceView(rules);
      banner.update({ kind: view.kind, message: view.message, action: bannerAction(view.action) });

      controls.types.setItems(rules.types);
      controls.headerMaxLength.setValue(rules.limits.header);
      controls.bodyMaxLineLength.setValue(rules.limits.body);
      controls.scopes.setRows(logic().scopesToRows(rules.scopes));
      controls.scopePolicy.setValue(rules.scopePolicy);

      const editable = rules.editable;
      controls.types.setDisabled(!editable);
      controls.headerMaxLength.setDisabled(!editable);
      controls.bodyMaxLineLength.setDisabled(!editable);
      controls.scopePolicy.setDisabled(!editable);
      controls.scopes.setReadOnly(!editable);

      const spacing = state.userSettings[BULLET_SPACING_KEY];
      controls.bulletSpacing.setValue(spacing.value);
      spacingRow.setSource(SOURCE_LABELS[spacing.source] || null, SOURCE_HINTS[spacing.source]);
      spacingRow.setResettable(spacing.source !== "default");
      for (const [field, row] of Object.entries(rows)) {
        const isSet = editable && rules.setFields.includes(field);
        row.setSource(isSet ? ".commitmgrc.json" : null, isSet ? "Set in .commitmgrc.json. Reset removes it, so the built-in value applies." : null);
        row.setResettable(isSet);
      }
    }

    return { id: "rules", label: "Rules", render, bind, refresh };
  }

  window.CommitMgTabs = window.CommitMgTabs || {};
  window.CommitMgTabs.createRulesTab = createRulesTab;
})();
