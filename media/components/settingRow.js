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
//   onCopy      - optional callback when the "User" source badge is clicked
//                 (copies the setting to the workspace)
//
// Returns:
//   control                  - the element to mount the control into
//   titleId                  - id of the title element
//   setSource(label, hint)   - show a source badge (for example the rules
//                              file name), or hide it with null
//   setStoredSource(source, canCopy)
//                            - for a VS Code setting: show the badge for
//                              "user" or "workspace" (hidden for anything
//                              else) and Reset only while the setting is
//                              stored. A "user" badge is clickable when
//                              canCopy is true and onCopy was given.
//   setSupport(state, hint)  - "supported" hides the badge; "partial" and
//                              "unsupported" show it with the hint
//   setResettable(boolean)   - show or hide Reset
//   setDisabled(boolean)     - dim the row

(function () {
  const SUPPORT_LABELS = { partial: "Partly supported", unsupported: "Not supported" };

  // The layers a VS Code setting can be stored in. Only the user layer can be
  // copied to the workspace, which is what the footer invites.
  const STORED_SOURCES = {
    user: {
      label: "User",
      hint: "Source: user settings. Reset removes it there. Changing it affects all workspaces.",
      footer: "Click to copy to this workspace.",
      reset: "Removes it from your user settings, so the default applies.",
    },
    workspace: {
      label: "Workspace",
      hint: "Source: workspace settings, which override your user settings. Reset removes it there.",
      footer: null,
      reset: "Removes it from this workspace, so your user setting (or the default) applies.",
    },
  };

  function badge(className) {
    const node = document.createElement("span");
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
    const sourceBadge = badge("setting-badge-source");
    const supportBadge = badge("setting-badge-support");

    // The source badge is a button only while it can copy the setting to
    // the workspace; otherwise it stays plain text.
    let copyEnabled = false;
    function setCopyEnabled(enabled) {
      copyEnabled = enabled;
      sourceBadge.classList.toggle("is-action", enabled);
      if (enabled) {
        sourceBadge.setAttribute("role", "button");
        sourceBadge.setAttribute("tabindex", "0");
        sourceBadge.setAttribute("aria-label", `Copy ${config.title} to this workspace`);
      } else {
        sourceBadge.removeAttribute("role");
        sourceBadge.removeAttribute("tabindex");
        sourceBadge.removeAttribute("aria-label");
      }
    }
    sourceBadge.addEventListener("click", () => {
      if (copyEnabled) {
        config.onCopy?.();
      }
    });
    sourceBadge.addEventListener("keydown", (event) => {
      if (copyEnabled && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        config.onCopy?.();
      }
    });

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
        setBadge(sourceBadge, label, hint, null);
        setCopyEnabled(false);
      },
      setStoredSource(source, canCopy) {
        const stored = STORED_SOURCES[source];
        const copyable = Boolean(stored && stored.footer && canCopy && config.onCopy);
        setBadge(sourceBadge, stored && stored.label, stored && stored.hint, copyable ? stored.footer : null);
        setCopyEnabled(copyable);
        reset.hidden = !stored;
        const resetHint = stored && stored.reset;
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
