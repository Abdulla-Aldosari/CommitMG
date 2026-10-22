/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The Message Format tab: how generated messages look, as personal
// preferences kept in VS Code (the project rules live on the Rules tab).
// The header form, the type emoji, the style the Source Control button
// uses, and extra instructions for the model. View Examples shows a
// sample message per detail level in the current settings, built by
// window.CommitMgSettingsLogic.formatExamples without a model request.
// Talks to the host only through post():
//   { type: "setUserSetting", key, value } - one edit
//   { type: "resetUserSetting", key }      - remove it from its layer
// The host validates and stores the value, then sends a new state, which
// refresh() draws.

(function () {
  const KEYS = {
    convention: "format.convention",
    emoji: "format.emojiPosition",
    spacing: "format.bulletSpacing",
    detail: "format.defaultDetail",
    instructions: "format.additionalInstructions",
  };
  const DETAIL_OPTIONS = [
    { value: "ask", label: "Ask every time" },
    { value: "lengthy", label: "Lengthy" },
    { value: "medium", label: "Medium" },
    { value: "short", label: "Short" },
    { value: "titleOnly", label: "Title only" },
  ];
  const INSTRUCTIONS_MAX = 1000;

  const controlId = (key) => `format-${key.replace(/\W/g, "-")}`;

  function createFormatTab(post, showExamples) {
    const c = window.CommitMgComponents;
    let controls = {};
    let rows = {};
    let current = null;

    const render = () => `
      <h2>Message Format</h2>
      <p class="tab-intro">How your generated messages look. These are your own preferences, saved in your VS Code settings; the project's rules are on the Rules tab.</p>
      <div id="format-convention-row"></div>
      <div id="format-emoji-row"></div>
      <div id="format-spacing-row"></div>
      <div id="format-detail-row"></div>
      <div id="format-instructions-row"></div>`;

    const send = (key, value) => post({ type: "setUserSetting", key, value });

    function mountRow(id, key, config) {
      const row = c.createSettingRow(document.getElementById(id), {
        id: controlId(key),
        onReset: () => post({ type: "resetUserSetting", key }),
        onCopy: () => post({ type: "copySettingToWorkspace", key }),
        ...config,
      });
      rows[key] = row;
      return row;
    }

    function examplesFor(state) {
      const settings = state.userSettings;
      return window.CommitMgSettingsLogic.formatExamples({
        convention: settings[KEYS.convention].value,
        emojiPosition: settings[KEYS.emoji].value,
        bulletSpacing: settings[KEYS.spacing].value,
        limits: state.rules.limits,
        types: state.rules.types,
      });
    }

    function refresh(state) {
      current = state;
      const settings = state.userSettings;
      controls.convention.setValue(settings[KEYS.convention].value);
      controls.emoji.setValue(settings[KEYS.emoji].value);
      controls.spacing.setValue(settings[KEYS.spacing].value);
      controls.detail.setValue(settings[KEYS.detail].value);
      controls.instructions.setValue(settings[KEYS.instructions].value);

      // A Basic header has no type, so it never gets a type emoji.
      const basic = settings[KEYS.convention].value === "basic";
      controls.emoji.setDisabled(basic);
      rows[KEYS.emoji].setDisabled(basic);

      for (const [key, row] of Object.entries(rows)) {
        row.setStoredSource(settings[key].source, state.hasWorkspace);
      }
    }

    function bind(state) {
      controls = {};
      rows = {};

      const conventionRow = mountRow("format-convention-row", KEYS.convention, {
        title: "Header form",
        description: "Conventional writes type(scope): subject. Basic writes a plain summary with no type and no scope, for projects that do not follow Conventional Commits.",
      });
      const conventionControls = document.createElement("div");
      conventionControls.className = "format-convention-controls";
      conventionRow.control.append(conventionControls);
      controls.convention = c.createSegmentedControl(conventionControls, {
        labelledBy: conventionRow.titleId,
        options: [
          { value: "conventional", label: "Conventional", tooltip: "feat(auth): add login" },
          { value: "basic", label: "Basic", tooltip: "Add login page" },
        ],
        value: "conventional",
        onChange: (value) => send(KEYS.convention, value),
      });
      const examplesButton = document.createElement("button");
      examplesButton.type = "button";
      examplesButton.className = "btn btn-ghost";
      examplesButton.textContent = "View Examples";
      examplesButton.addEventListener("click", () => showExamples(examplesFor(current)));
      conventionControls.append(examplesButton);

      const emojiRow = mountRow("format-emoji-row", KEYS.emoji, {
        title: "Type emoji",
        description:
          "Adds the emoji of the commit type, such as \u2728 for feat or \u{1F41B} for fix. The model only picks the type; the emoji follows from it. commitlint accepts the emoji before the subject, not before the type.",
      });
      controls.emoji = c.createSegmentedControl(emojiRow.control, {
        labelledBy: emojiRow.titleId,
        options: [
          { value: "off", label: "Off" },
          { value: "beforeType", label: "Before type", tooltip: "\u2728 feat(auth): add login" },
          { value: "beforeSubject", label: "Before subject", tooltip: "feat(auth): \u2728 add login" },
        ],
        value: "off",
        onChange: (value) => send(KEYS.emoji, value),
      });

      const spacingRow = mountRow("format-spacing-row", KEYS.spacing, {
        title: "Space between bullet points",
        description: "Blank puts one empty line between body bullet points; Compact puts them on consecutive lines.",
      });
      controls.spacing = c.createSegmentedControl(spacingRow.control, {
        labelledBy: spacingRow.titleId,
        options: [
          { value: "blank", label: "Blank line" },
          { value: "compact", label: "Compact" },
        ],
        value: "blank",
        onChange: (value) => send(KEYS.spacing, value),
      });

      const detailRow = mountRow("format-detail-row", KEYS.detail, {
        title: "Source Control button",
        description:
          "The detail level the button generates with. With a level chosen, Generate Commit Message with Another Style in the Source Control menu picks a different one for a single message.",
      });
      controls.detail = c.createDropdown(detailRow.control, {
        id: controlId(KEYS.detail),
        labelledBy: detailRow.titleId,
        options: DETAIL_OPTIONS,
        value: "ask",
        onChange: (value) => send(KEYS.detail, value),
      });

      const instructionsRow = mountRow("format-instructions-row", KEYS.instructions, {
        title: "Extra instructions",
        description: 'Added to every prompt after the rules, such as "Mention the ticket number from the branch name". The rules win when the two conflict.',
        layout: "stacked",
      });
      controls.instructions = c.createTextAreaCounter(instructionsRow.control, {
        id: `${controlId(KEYS.instructions)}-input`,
        labelledBy: instructionsRow.titleId,
        maxLength: INSTRUCTIONS_MAX,
        placeholder: "Use British spelling.",
        // The host stores only clean text (trimmed, no control characters),
        // so the text is cleaned the same way before it is sent.
        onChange: (text) => send(KEYS.instructions, window.CommitMgSettingsLogic.normalizeAdditionalInstructions(text)),
      });

      refresh(state);
    }

    return { id: "format", label: "Message Format", render, bind, refresh };
  }

  window.CommitMgTabs = window.CommitMgTabs || {};
  window.CommitMgTabs.createFormatTab = createFormatTab;
})();
