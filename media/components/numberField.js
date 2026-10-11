/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Number field: a text input with an optional unit and an inline error. The
// value is checked by window.CommitMgSettingsLogic.parseNumberInput
// (src/webview/numberField.ts) and only a valid value is emitted, on blur or
// Enter, so a half-typed number never reaches the host.
//
// createNumberField(root, config) fills an empty container.
//
// config:
//   id          - id of the <input>, so a <label for> can name it
//   value       - initial value (number, or null for Auto)
//   min, max    - inclusive range
//   integer     - whole numbers only (default true)
//   allowEmpty  - an empty field means Auto (default false)
//   placeholder - shown while empty (e.g. "Auto")
//   unit        - optional unit after the input (e.g. "tokens")
//   disabled    - initial disabled state (default false)
//   onChange    - optional callback onChange(value) after a valid user
//                 change; value is null for Auto
//
// Output: onChange(value), and a "change" CustomEvent on root with
// detail = { value }. setValue() never emits.
//
// Returns { getValue, setValue, setDisabled }.

(function () {
  function createNumberField(root, config) {
    const rules = {
      min: config.min,
      max: config.max,
      integer: config.integer !== false,
      allowEmpty: config.allowEmpty === true,
    };
    let value = config.value ?? null;

    root.classList.add("number-field");
    const row = document.createElement("div");
    row.className = "number-field-row";
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = rules.integer ? "numeric" : "decimal";
    input.className = "number-field-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (config.id) {
      input.id = config.id;
    }
    if (config.placeholder) {
      input.placeholder = config.placeholder;
    }
    row.append(input);
    if (config.unit) {
      const unit = document.createElement("span");
      unit.className = "number-field-unit";
      unit.textContent = config.unit;
      row.append(unit);
    }
    const error = document.createElement("div");
    error.className = "number-field-error";
    error.id = `${config.id || "number-field"}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;
    input.setAttribute("aria-describedby", error.id);
    root.append(row, error);

    const show = (current) => {
      input.value = current === null ? "" : String(current);
    };

    function setError(message) {
      error.textContent = message || "";
      error.hidden = !message;
      input.setAttribute("aria-invalid", message ? "true" : "false");
      root.classList.toggle("has-error", Boolean(message));
    }

    // Checks the typed text; emits when it is valid and differs from the
    // current value. Returns whether the text was valid.
    function commit() {
      const result = window.CommitMgSettingsLogic.parseNumberInput(input.value, rules);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setError("");
      show(result.value);
      if (result.value !== value) {
        value = result.value;
        config.onChange?.(value);
        root.dispatchEvent(new CustomEvent("change", { detail: { value } }));
      }
      return true;
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        show(value);
        setError("");
      }
    });

    show(value);
    input.disabled = Boolean(config.disabled);

    return {
      getValue: () => value,
      setValue(next) {
        value = next ?? null;
        show(value);
        setError("");
      },
      setDisabled(disabled) {
        input.disabled = Boolean(disabled);
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createNumberField = createNumberField;
})();
