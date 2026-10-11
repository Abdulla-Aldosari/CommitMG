/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Toggle switch: a single <button role="switch"> whose aria-checked carries
// the state; the track and the thumb are drawn by CSS (.toggle-switch).
//
// createToggleSwitch(root, config) turns an existing <button> into a switch.
//
// config:
//   checked        - initial state (default false)
//   disabled       - initial disabled state (default false)
//   labelledBy     - id of the element that names the switch
//                    (aria-labelledby); use label instead when there is none
//   label          - accessible name when no visible label exists
//   onChange       - optional callback onChange(checked) after a user change
//
// Output: onChange(checked), and a "change" CustomEvent on root with
// detail = { checked }. Programmatic setChecked() never emits, so a state
// refresh from the host cannot echo back as a user change.
//
// Returns { getChecked, setChecked, setDisabled }.

(function () {
  function createToggleSwitch(root, config = {}) {
    root.type = "button";
    root.classList.add("toggle-switch");
    root.setAttribute("role", "switch");
    if (config.labelledBy) {
      root.setAttribute("aria-labelledby", config.labelledBy);
    } else if (config.label) {
      root.setAttribute("aria-label", config.label);
    }

    const getChecked = () => root.getAttribute("aria-checked") === "true";

    function setChecked(checked) {
      root.setAttribute("aria-checked", checked ? "true" : "false");
    }

    function setDisabled(disabled) {
      root.disabled = Boolean(disabled);
    }

    // A native <button> fires "click" for the mouse and for Space/Enter.
    root.addEventListener("click", () => {
      if (root.disabled) {
        return;
      }
      const next = !getChecked();
      setChecked(next);
      config.onChange?.(next);
      root.dispatchEvent(new CustomEvent("change", { detail: { checked: next } }));
    });

    setChecked(Boolean(config.checked));
    setDisabled(config.disabled);

    return { getChecked, setChecked, setDisabled };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createToggleSwitch = createToggleSwitch;
})();
