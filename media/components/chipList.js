/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Chip list: an editable list of short strings (file patterns, types). Each
// item is a chip with a remove button; a text input adds new items on Enter
// or the Add button. A validate() hook rejects bad input inline.
//
// createChipList(root, config) fills an empty container.
//
// config:
//   id          - id of the <input>, so a <label for> can name it
//   label       - accessible name of the list
//   items       - initial list of strings
//   placeholder - input placeholder
//   validate    - optional validate(text, items) returning an error message
//                 or null
//   onChange    - optional callback onChange(items) after a user change
//
// Output: onChange(items), and a "change" CustomEvent on root with
// detail = { items }. setItems() never emits.
//
// Returns { getItems, setItems, setDisabled }.

(function () {
  function createChipList(root, config) {
    let items = [...(config.items || [])];
    let disabled = false;

    root.classList.add("chip-list");
    const list = document.createElement("ul");
    list.className = "chip-list-items";
    list.setAttribute("aria-label", config.label || "Items");

    const entry = document.createElement("div");
    entry.className = "chip-list-entry";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chip-list-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (config.id) {
      input.id = config.id;
    }
    if (config.placeholder) {
      input.placeholder = config.placeholder;
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-ghost chip-list-add";
    add.textContent = "Add";
    entry.append(input, add);

    const error = document.createElement("div");
    error.className = "chip-list-error";
    error.id = `${config.id || "chip-list"}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;
    input.setAttribute("aria-describedby", error.id);
    root.append(list, entry, error);

    function setError(message) {
      error.textContent = message || "";
      error.hidden = !message;
      input.setAttribute("aria-invalid", message ? "true" : "false");
    }

    function emit() {
      config.onChange?.([...items]);
      root.dispatchEvent(new CustomEvent("change", { detail: { items: [...items] } }));
    }

    function render() {
      list.replaceChildren(
        ...items.map((item, index) => {
          const chip = document.createElement("li");
          chip.className = "chip";
          const text = document.createElement("span");
          text.className = "chip-text";
          text.textContent = item;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "chip-remove";
          remove.textContent = "\u00d7";
          remove.setAttribute("aria-label", `Remove ${item}`);
          remove.disabled = disabled;
          remove.addEventListener("click", () => {
            items = items.filter((_, i) => i !== index);
            render();
            emit();
            input.focus();
          });
          chip.append(text, remove);
          return chip;
        }),
      );
      input.disabled = disabled;
      add.disabled = disabled;
    }

    function addFromInput() {
      const text = input.value.trim();
      if (text === "") {
        return;
      }
      const problem = config.validate ? config.validate(text, items) : null;
      if (problem) {
        setError(problem);
        return;
      }
      setError("");
      items = [...items, text];
      input.value = "";
      render();
      emit();
    }

    add.addEventListener("click", addFromInput);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addFromInput();
      }
    });
    input.addEventListener("input", () => setError(""));

    render();

    return {
      getItems: () => [...items],
      setItems(next) {
        items = [...(next || [])];
        render();
      },
      setDisabled(next) {
        disabled = Boolean(next);
        render();
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createChipList = createChipList;
})();
