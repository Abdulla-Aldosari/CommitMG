/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Text area with a character counter: free text up to a maximum length,
// such as the extra instructions for the model. The counter shows the
// characters used of the maximum and turns into a warning near the end;
// the browser's maxlength stops typing at the maximum. The value is
// emitted when the text area loses focus, so a half-typed sentence never
// reaches the host on every keystroke.
//
// createTextAreaCounter(root, config) fills an empty container.
//
// config:
//   id          - id of the <textarea>
//   labelledBy  - id of the element that names the text area
//   value       - initial text
//   maxLength   - most characters allowed
//   rows        - visible rows (default 4)
//   placeholder - shown while empty
//   onChange    - optional onChange(text) after the user changed the text
//                 and left the text area
//
// Output: onChange(text), and a "change" CustomEvent on root with
// detail = { value }. setValue() never emits, and never replaces text the
// user is typing.
//
// Returns { getValue, setValue, setDisabled }.

(function () {
  // The counter warns once this share of the maximum is used.
  const WARN_RATIO = 0.9;

  function createTextAreaCounter(root, config) {
    let value = config.value || "";

    root.classList.add("text-area-counter");
    const area = document.createElement("textarea");
    area.className = "text-area-counter-input";
    area.rows = config.rows || 4;
    area.maxLength = config.maxLength;
    area.spellcheck = true;
    if (config.id) {
      area.id = config.id;
    }
    if (config.labelledBy) {
      area.setAttribute("aria-labelledby", config.labelledBy);
    }
    if (config.placeholder) {
      area.placeholder = config.placeholder;
    }
    const counter = document.createElement("div");
    counter.className = "text-area-counter-count";
    counter.id = `${config.id || "text-area"}-count`;
    // Read when focus enters, not on every keystroke.
    area.setAttribute("aria-describedby", counter.id);
    root.append(area, counter);

    function showCount() {
      const used = area.value.length;
      counter.textContent = `${used.toLocaleString("en-US")} / ${config.maxLength.toLocaleString("en-US")}`;
      counter.classList.toggle("is-near-limit", used >= config.maxLength * WARN_RATIO);
    }

    area.addEventListener("input", showCount);
    area.addEventListener("change", () => {
      if (area.value === value) {
        return;
      }
      value = area.value;
      config.onChange?.(value);
      root.dispatchEvent(new CustomEvent("change", { detail: { value } }));
    });

    area.value = value;
    showCount();

    return {
      getValue: () => value,
      setValue(next) {
        value = next || "";
        if (document.activeElement !== area) {
          area.value = value;
          showCount();
        }
      },
      setDisabled(disabled) {
        area.disabled = Boolean(disabled);
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createTextAreaCounter = createTextAreaCounter;
})();
