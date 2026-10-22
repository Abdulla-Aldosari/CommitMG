/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Info banner: a short notice at the top of a tab or section (which rules
// source is active, a workspace-trust note, a settings conflict), with an
// optional action button.
//
// createInfoBanner(root, config) fills an empty container.
//
// config:
//   kind     - "info" (default), "warning", or "error"
//   message  - plain text
//   action   - optional { label, onClick, disabled }
//   reserve  - optional boolean; keeps the banner at least three text lines
//              tall, so changing text does not move what follows
//
// Returns { update(config) } to change the kind, text, or action in place;
// update({ message: "" }) hides the banner.

(function () {
  const ICONS = { info: "circleInfo", warning: "exclamationTriangle", error: "exclamationTriangle" };

  function createInfoBanner(root, config) {
    const banner = document.createElement("div");
    const icon = document.createElement("span");
    icon.className = "info-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "info-banner-text";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn btn-ghost info-banner-action";
    banner.append(icon, text, action);
    root.append(banner);

    let onAction = null;
    action.addEventListener("click", () => onAction?.());

    function update(next) {
      const kind = ICONS[next.kind] ? next.kind : "info";
      banner.className = `info-banner info-banner-${kind}${next.reserve ? ` info-banner-reserved` : ""}`;
      // Errors interrupt; other notices are announced politely.
      banner.setAttribute("role", kind === "error" ? "alert" : "status");
      icon.innerHTML = window.icons[ICONS[kind]];
      text.textContent = next.message || "";
      banner.hidden = !next.message;
      onAction = next.action ? next.action.onClick : null;
      action.textContent = next.action ? next.action.label : "";
      action.hidden = !next.action;
      action.disabled = Boolean(next.action?.disabled);
    }

    update(config);
    return { update };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createInfoBanner = createInfoBanner;
})();
