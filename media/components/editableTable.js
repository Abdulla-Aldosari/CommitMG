/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Editable table: rows of short text cells, such as scopes with their
// descriptions and files. Each row has one input per column and a remove
// button; Add appends an empty row. Edits are kept as a draft and committed
// when an input loses focus or Enter is pressed: validate(rows) checks the
// whole draft, and only a valid draft is emitted, so a half-filled row
// never reaches the host. Rows whose cells are all empty are not part of
// the value. Problems are listed under the table.
//
// createEditableTable(root, config) fills an empty container.
//
// config:
//   id        - base id for the problem list
//   label     - accessible name of the table
//   columns   - [{ key, label, placeholder?, width? }]; width is a CSS
//               width for the column (e.g. "25%")
//   rows      - initial rows: objects of strings keyed by column key
//   addLabel  - text of the Add button (default "Add row")
//   emptyText - shown when there are no rows
//   rowName   - optional rowName(row, index) naming a row for screen
//               readers (default "row N")
//   validate  - optional validate(rows) returning a list of problems
//   onChange  - optional onChange(rows) after a valid user change
//
// Output: onChange(rows), and a "change" CustomEvent on root with
// detail = { rows }. setRows() never emits.
//
// Returns { getRows, setRows, setReadOnly }. A read-only table shows its
// cells as text, without inputs or buttons.

(function () {
  const copyRows = (rows) => rows.map((row) => ({ ...row }));
  const sameRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function createEditableTable(root, config) {
    const columns = config.columns;
    const blankRow = () => Object.fromEntries(columns.map((column) => [column.key, ""]));
    const isFilled = (row) => columns.some((column) => row[column.key] !== "");
    // applied: the rows the host holds (set by setRows or last emitted).
    // draft: what the inputs show, which may hold unsaved edits.
    let applied = copyRows(config.rows || []);
    let draft = copyRows(applied);
    let readOnly = false;

    root.classList.add("editable-table");
    const table = document.createElement("table");
    table.className = "editable-table-grid";
    table.setAttribute("aria-label", config.label || "Table");
    const headRow = document.createElement("tr");
    for (const column of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = column.label;
      if (column.width) {
        th.style.width = column.width;
      }
      headRow.append(th);
    }
    const actionsHead = document.createElement("th");
    actionsHead.scope = "col";
    actionsHead.className = "editable-table-actions";
    actionsHead.setAttribute("aria-label", "Actions");
    headRow.append(actionsHead);
    const head = document.createElement("thead");
    head.append(headRow);
    const body = document.createElement("tbody");
    table.append(head, body);

    const empty = document.createElement("p");
    empty.className = "editable-table-empty";
    empty.textContent = config.emptyText || "No rows.";

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-ghost editable-table-add";
    add.textContent = config.addLabel || "Add row";

    const problemList = document.createElement("ul");
    problemList.className = "editable-table-problems";
    problemList.id = `${config.id || "editable-table"}-problems`;
    problemList.setAttribute("role", "alert");
    problemList.hidden = true;
    root.append(table, empty, add, problemList);

    function showProblems(problems) {
      problemList.replaceChildren(
        ...problems.map((problem) => {
          const item = document.createElement("li");
          item.textContent = problem;
          return item;
        }),
      );
      problemList.hidden = problems.length === 0;
    }

    function commit() {
      const rows = draft.filter(isFilled);
      const problems = config.validate ? config.validate(copyRows(rows)) : [];
      showProblems(problems);
      if (problems.length > 0 || sameRows(rows, applied)) {
        return;
      }
      applied = copyRows(rows);
      config.onChange?.(copyRows(rows));
      root.dispatchEvent(new CustomEvent("change", { detail: { rows: copyRows(rows) } }));
    }

    function renderCell(row, index, column, name) {
      const cell = document.createElement("td");
      if (readOnly) {
        cell.className = "editable-table-text";
        cell.textContent = row[column.key];
        return cell;
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "editable-table-input";
      input.value = row[column.key];
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = column.placeholder || "";
      input.setAttribute("aria-label", `${column.label} of ${name}`);
      input.setAttribute("aria-describedby", problemList.id);
      const store = () => {
        draft[index][column.key] = input.value.trim();
        commit();
      };
      input.addEventListener("change", store);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          store();
        }
      });
      cell.append(input);
      return cell;
    }

    function renderRow(row, index) {
      const tableRow = document.createElement("tr");
      const name = config.rowName ? config.rowName(row, index) : `row ${index + 1}`;
      for (const column of columns) {
        tableRow.append(renderCell(row, index, column, name));
      }
      const actions = document.createElement("td");
      actions.className = "editable-table-actions";
      if (!readOnly) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "editable-table-remove";
        remove.textContent = "\u00d7";
        remove.setAttribute("aria-label", `Remove ${name}`);
        remove.addEventListener("click", () => {
          draft = draft.filter((_, i) => i !== index);
          render();
          commit();
          add.focus();
        });
        actions.append(remove);
      }
      tableRow.append(actions);
      return tableRow;
    }

    function render() {
      body.replaceChildren(...draft.map((row, index) => renderRow(row, index)));
      table.hidden = draft.length === 0;
      empty.hidden = draft.length > 0;
      add.hidden = readOnly;
      actionsHead.hidden = readOnly;
    }

    add.addEventListener("click", () => {
      draft = [...draft, blankRow()];
      render();
      body.lastElementChild?.querySelector("input")?.focus();
    });

    render();

    return {
      getRows: () => copyRows(applied),
      // Rows equal to the ones the host already holds keep the draft, so a
      // redraw caused by another edit never wipes unsaved typing.
      setRows(next) {
        const rows = copyRows(next || []);
        if (sameRows(rows, applied)) {
          return;
        }
        applied = rows;
        draft = copyRows(rows);
        showProblems([]);
        render();
      },
      setReadOnly(next) {
        readOnly = Boolean(next);
        draft = copyRows(applied);
        showProblems([]);
        render();
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createEditableTable = createEditableTable;
})();
