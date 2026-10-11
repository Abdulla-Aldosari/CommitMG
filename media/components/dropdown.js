/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Dropdown: a single choice from a short list, drawn with the panel's
// custom select (customSelect.js) so it matches the AI Settings tab. Use it
// where the choices are not points on a scale.
//
// createDropdown(root, config) fills an empty container.
//
// config:
//   id         - base id for the button and the menu
//   labelledBy - id of the element that names the dropdown
//   options    - [{ value, label, badgeEnd?, groupLabel? }]; groupLabel
//                starts a titled group in the menu
//   value      - initial value
//   onChange   - called with the value after the user picks a different
//                one; never called by setValue()
//
// Returns { getValue, setValue, setDisabled }.

(function () {
  function createDropdown(root, config) {
    const wrapperId = `${config.id}-wrap`;
    const buttonId = `${config.id}-button`;
    const menuId = `${config.id}-menu`;
    let value = config.value;
    let disabled = false;

    function draw() {
      root.innerHTML = window.renderCustomSelect(wrapperId, buttonId, menuId, config.options, value, "", false, "");
      const button = document.getElementById(buttonId);
      if (config.labelledBy) {
        button.setAttribute("aria-labelledby", `${config.labelledBy} ${buttonId}`);
      }
      button.disabled = disabled;
      window.bindCustomSelect(wrapperId, buttonId, menuId, (picked) => {
        const option = config.options.find((candidate) => String(candidate.value) === picked);
        if (!option || option.value === value) {
          return;
        }
        value = option.value;
        config.onChange?.(value);
      });
    }

    draw();

    return {
      getValue: () => value,
      setValue(next) {
        if (next !== value) {
          value = next;
          draw();
        }
      },
      setDisabled(next) {
        disabled = Boolean(next);
        document.getElementById(buttonId).disabled = disabled;
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createDropdown = createDropdown;
})();
