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
//   onCopy      - optional callback when the "User" or "Default" source
//                 badge is clicked (sets the setting in the workspace)
//
// Returns:
//   control                  - the element to mount the control into
//   titleId                  - id of the title element
//   setSource(label, hint)   - show a plain source badge (for example the
//                              rules file name), or hide it with null
//   setStoredSource(source, hasWorkspace)
//                            - for a VS Code setting: show the badge for
//                              "user", "workspace", or "default", and Reset
//                              only while the setting is stored. The "user"
//                              and "default" badges are real buttons when
//                              the window has a workspace and onCopy was
//                              given; otherwise they are plain text. What
//                              each badge says comes from
//                              CommitMgSettingsLogic.settingBadgeView.
//   setSupport(state, hint)  - "supported" hides the badge; "partial" and
//                              "unsupported" show it with the hint
//   setResettable(boolean)   - show or hide Reset
//   setDisabled(boolean)     - dim the row

(function () {
  const SUPPORT_LABELS = { partial: "Partly supported", unsupported: "Not supported" };

  function badge(className, tag) {
    const node = document.createElement(tag || "span");
    node.className = `setting-badge ${className}`;
    node.hidden = true;
    return node;
  }

  function setAttributeOrRemove(node, name, value) {
    if (value) {
      node.setAttribute(name, value);
    } else {
      node.removeAttribute(name);
    }
  }

  function setBadge(node, label, hint, footer) {
    node.textContent = label || "";
    node.hidden = !label;
    setAttributeOrRemove(node, "data-tooltip", hint);
    setAttributeOrRemove(node, "data-tooltip-footer", footer);
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
    // Two elements share the badge's place: plain text, or a real button
    // when clicking the badge sets the setting in the workspace. Only one is
    // shown at a time.
    const sourceBadge = badge("setting-badge-source");
    const sourceButton = badge("setting-badge-source", "button");
    sourceButton.type = "button";
    sourceButton.addEventListener("click", () => config.onCopy?.());
    const supportBadge = badge("setting-badge-support");

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "setting-row-reset";
    reset.textContent = "Reset";
    reset.setAttribute("aria-label", `Reset ${config.title} to its default`);
    reset.hidden = true;
    reset.addEventListener("click", () => config.onReset?.());
    heading.append(title, sourceBadge, sourceButton, supportBadge, reset);
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
        setBadge(sourceBadge, label, hint, null);
        setBadge(sourceButton, null, null, null);
      },
      setStoredSource(source, hasWorkspace) {
        const view = window.CommitMgSettingsLogic.settingBadgeView(source, hasWorkspace);
        const clickable = Boolean(view && view.clickable && config.onCopy);
        const shown = clickable ? sourceButton : sourceBadge;
        const hidden = clickable ? sourceBadge : sourceButton;
        setBadge(hidden, null, null, null);
        setBadge(shown, view && view.label, view && view.tooltip, view && view.footer);
        const isDefault = Boolean(view) && source === "default";
        sourceBadge.classList.toggle("is-default", isDefault);
        sourceButton.classList.toggle("is-default", isDefault);
        if (clickable) {
          sourceButton.setAttribute("aria-label", `${config.title}: ${view.label}. Set it in this workspace only`);
        } else {
          sourceButton.removeAttribute("aria-label");
        }
        reset.hidden = !(view && view.resettable);
        const resetHint = view && view.resetHint;
        setAttributeOrRemove(reset, "data-tooltip", resetHint);
        reset.setAttribute("aria-label", resetHint ? `Reset ${config.title}. ${resetHint}` : `Reset ${config.title} to its default`);
      },
      setSupport(state, hint) {
        setBadge(supportBadge, SUPPORT_LABELS[state], hint, null);
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
