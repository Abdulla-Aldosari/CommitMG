/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Segmented control: two to four mutually exclusive options shown side by
// side (for choices with no order, unlike the step slider). Built as a
// radiogroup: Tab enters the group on the selected option, the arrow keys
// move and select, Home and End jump to the ends.
//
// createSegmentedControl(root, config) fills an empty container.
//
// config:
//   label      - accessible name of the group (when labelledBy is absent)
//   labelledBy - id of the element that names the group
//   options    - list of { value, label, tooltip? }
//   value      - the selected value; unknown values select the first
//   disabled   - initial disabled state (default false)
//   onChange   - optional callback onChange(value) after a user change
//
// Output: onChange(value), and a "change" CustomEvent on root with
// detail = { value }. setValue() never emits.
//
// Returns { getValue, setValue, setDisabled }.

(function () {
  function createSegmentedControl(root, config) {
    const options = config.options;
    let value = options.some((option) => option.value === config.value) ? config.value : options[0].value;
    let disabled = Boolean(config.disabled);

    root.classList.add("segmented-control");
    root.setAttribute("role", "radiogroup");
    if (config.labelledBy) {
      root.setAttribute("aria-labelledby", config.labelledBy);
    } else if (config.label) {
      root.setAttribute("aria-label", config.label);
    }

    const buttons = options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-control-option";
      button.setAttribute("role", "radio");
      button.dataset.value = option.value;
      button.textContent = option.label;
      if (option.tooltip) {
        button.setAttribute("data-tooltip", option.tooltip);
      }
      root.append(button);
      return button;
    });

    function render() {
      for (const button of buttons) {
        const selected = button.dataset.value === value;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.disabled = disabled;
      }
      root.classList.toggle("is-disabled", disabled);
    }

    function select(next, focus) {
      if (disabled) {
        return;
      }
      const index = Math.max(0, Math.min(buttons.length - 1, next));
      if (focus) {
        buttons[index].focus();
      }
      const nextValue = buttons[index].dataset.value;
      if (nextValue === value) {
        return;
      }
      value = nextValue;
      render();
      config.onChange?.(value);
      root.dispatchEvent(new CustomEvent("change", { detail: { value } }));
    }

    buttons.forEach((button, index) => {
      button.addEventListener("click", () => select(index, false));
      button.addEventListener("keydown", (event) => {
        const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
        if (!(event.key in moves)) {
          return;
        }
        event.preventDefault();
        select(moves[event.key], true);
      });
    });

    render();

    return {
      getValue: () => value,
      setValue(next) {
        if (options.some((option) => option.value === next)) {
          value = next;
          render();
        }
      },
      setDisabled(nextDisabled) {
        disabled = Boolean(nextDisabled);
        render();
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createSegmentedControl = createSegmentedControl;
})();
