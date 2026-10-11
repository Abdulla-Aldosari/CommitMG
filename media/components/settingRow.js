/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Setting row: the frame every setting sits in. A title and a description on
// the left, the control on the right (or below, for wide controls), a source
// badge (where the value comes from), a support badge (whether the chosen
// model honors it), and a Reset button shown only when the value is not the
// default.
//
// createSettingRow(root, config) fills an empty container.
//
// config:
//   id          - base id; the title gets `${id}-title` so a control can
//                 use it as aria-labelledby
//   title       - setting name
//   description - optional one-line explanation (plain text)
//   layout      - "inline" (control on the right, default) or "stacked"
//                 (control below the text, for sliders and tables)
//   onReset     - optional callback when Reset is pressed
//
// Returns:
//   control                  - the element to mount the control into
//   titleId                  - id of the title element
//   setSource(label, hint)   - show a source badge ("User", "Workspace"),
//                              or hide it with null
//   setSupport(state, hint)  - "supported" hides the badge; "partial" and
//                              "unsupported" show it with the hint
//   setResettable(boolean)   - show or hide Reset
//   setDisabled(boolean)     - dim the row

(function () {
  const SUPPORT_LABELS = { partial: "Partly supported", unsupported: "Not supported" };

  function badge(className) {
    const node = document.createElement("span");
    node.className = `setting-badge ${className}`;
    node.hidden = true;
    return node;
  }

  function setBadge(node, label, hint) {
    node.textContent = label || "";
    node.hidden = !label;
    if (hint) {
      node.setAttribute("data-tooltip", hint);
    } else {
      node.removeAttribute("data-tooltip");
    }
  }

  function createSettingRow(root, config) {
    const titleId = `${config.id}-title`;
    root.classList.add("setting-row", config.layout === "stacked" ? "setting-row-stacked" : "setting-row-inline");

    const text = document.createElement("div");
    text.className = "setting-row-text";
    const heading = document.createElement("div");
    heading.className = "setting-row-heading";
    const title = document.createElement("span");
    title.className = "setting-row-title";
    title.id = titleId;
    title.textContent = config.title;
    const sourceBadge = badge("setting-badge-source");
    const supportBadge = badge("setting-badge-support");
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "setting-row-reset";
    reset.textContent = "Reset";
    reset.setAttribute("aria-label", `Reset ${config.title} to its default`);
    reset.hidden = true;
    reset.addEventListener("click", () => config.onReset?.());
    heading.append(title, sourceBadge, supportBadge, reset);
    text.append(heading);

    if (config.description) {
      const description = document.createElement("div");
      description.className = "setting-row-description";
      description.textContent = config.description;
      text.append(description);
    }

    const control = document.createElement("div");
    control.className = "setting-row-control";
    root.append(text, control);

    return {
      control,
      titleId,
      setSource(label, hint) {
        setBadge(sourceBadge, label, hint);
      },
      setSupport(state, hint) {
        setBadge(supportBadge, SUPPORT_LABELS[state], hint);
        supportBadge.classList.toggle("is-unsupported", state === "unsupported");
      },
      setResettable(resettable) {
        reset.hidden = !resettable;
      },
      setDisabled(disabled) {
        root.classList.toggle("is-disabled", Boolean(disabled));
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createSettingRow = createSettingRow;
})();
