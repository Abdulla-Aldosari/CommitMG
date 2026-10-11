/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Collapsible section: a native <details>/<summary> pair, so the browser
// handles the keyboard and screen readers. Used for the "Advanced" groups.
//
// createCollapsibleSection(root, config) fills an empty container.
//
// config:
//   title    - summary text
//   open     - initial state (default false)
//   onToggle - optional callback onToggle(open) after the user opens or
//              closes it, so a tab can remember the state across redraws
//
// Returns { body, setOpen }: body is the element to mount the section's
// rows into.

(function () {
  function createCollapsibleSection(root, config) {
    const details = document.createElement("details");
    details.className = "collapsible-section";
    details.open = Boolean(config.open);
    const summary = document.createElement("summary");
    summary.className = "collapsible-section-summary";
    summary.textContent = config.title;
    const body = document.createElement("div");
    body.className = "collapsible-section-body";
    details.append(summary, body);
    root.append(details);

    details.addEventListener("toggle", () => config.onToggle?.(details.open));

    return {
      body,
      setOpen(open) {
        details.open = Boolean(open);
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createCollapsibleSection = createCollapsibleSection;
})();
