/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Reusable custom-select dropdown component, extracted from MindStream's
// media/sidebar.js (renderCustomSelect/bindCustomSelect/closeAllDropdowns)
// with one additive extension: each option may carry a `groupLabel`, which
// renders a non-interactive heading row above the first option of each
// group (used by the AI-provider dropdown to show "Direct API" / "VS Code
// Language Model" / "Custom" sections). Options without groupLabel (or a
// repeat of the previous option's groupLabel) render exactly as before, so
// this is backward-compatible with every other call site.

(function () {
  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  const csIcons = {
    chevron:
      '<svg width="17" height="17" viewBox="0 0 21 21" class="cs-chevron" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="m6 9l6 6l6-6"></path></svg>',
    checkmark:
      '<svg width="17" height="17" viewBox="0 0 24 24" class="cs-check" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"></path></svg>',
  };

  // Registry of bound dropdown close functions, keyed by menuId. Populated by
  // bindCustomSelect() and consumed by closeAllDropdowns() so that every open
  // menu can be dismissed atomically (hidden + its document/window listeners
  // removed) from a single choke point, e.g. when opening any modal.
  const menuCloseHandlers = {};

  // options: Array<{ value, label, badgeStart?, badgeEnd?, itemClass?, groupLabel? }>
  function renderCustomSelect(wrapperId, btnId, menuId, options, selectedValue, btnExtraClass, menuUp, wrapExtraClass) {
    const selectedOption = options.find(function (o) {
      return o.value === selectedValue;
    });
    const selectedLabel = selectedOption ? selectedOption.label : options.length ? options[0].label : "-";

    let previousGroupLabel = null;
    const items = options
      .map(function (opt) {
        const isSelected = opt.value === selectedValue;
        const badgeStartHtml = opt.badgeStart ? `<span class="cs-item-badge">${opt.badgeStart}</span>` : "";
        const badgeEndHtml = opt.badgeEnd ? `<span class="cs-item-badge">${opt.badgeEnd}</span>` : "";
        const itemClass = opt.itemClass ? ` ${opt.itemClass}` : "";

        let groupHeadingHtml = "";
        if (opt.groupLabel && opt.groupLabel !== previousGroupLabel) {
          groupHeadingHtml = `<div class="cs-group-heading">${escapeHtml(opt.groupLabel)}</div>`;
        }
        previousGroupLabel = opt.groupLabel || previousGroupLabel;

        return `${groupHeadingHtml}<div class="cs-item${itemClass}" role="menuitem" tabindex="-1" data-value="${escapeAttr(opt.value)}">
          <span class="cs-item-label-group">${badgeStartHtml}<span class="cs-item-label">${escapeHtml(opt.label)}</span>${badgeEndHtml}</span>
          ${isSelected ? csIcons.checkmark : ""}
        </div>`;
      })
      .join("");

    const menuClass = `cs-menu${menuUp ? " cs-menu-up" : ""}`;
    const wrapClass = `cs-wrap${wrapExtraClass ? ` ${wrapExtraClass}` : ""}`;
    const selectedItemClass = selectedOption && selectedOption.itemClass ? ` ${selectedOption.itemClass}` : "";
    const btnClass = `cs-btn${btnExtraClass ? ` ${btnExtraClass}` : ""}${selectedItemClass}`;

    return `<div class="${wrapClass}" id="${escapeAttr(wrapperId)}">
      <button class="${btnClass}" type="button" aria-haspopup="menu" aria-expanded="false" id="${escapeAttr(btnId)}">
        <span class="cs-btn-label">${escapeHtml(selectedLabel)}</span>
        ${csIcons.chevron}
      </button>
      <div class="${menuClass}" role="menu" id="${escapeAttr(menuId)}" hidden>
        <div class="cs-menu-items-wrapper">${items}</div>
      </div>
    </div>`;
  }

  function bindCustomSelect(wrapperId, btnId, menuId, onChange) {
    const wrap = document.getElementById(wrapperId);
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);

    if (!btn || !menu) {
      return;
    }

    function closeMenu() {
      if (!menu.hidden) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
    }

    // Expose this dropdown's close function so closeAllDropdowns() can dismiss
    // it (and clean up its listeners) from outside the closure. Re-binding the
    // same menuId after a re-render simply overwrites the stale entry.
    menuCloseHandlers[menuId] = closeMenu;

    function onPointerDown(e) {
      if (wrap && !wrap.contains(e.target)) {
        closeMenu();
      }
    }

    function onWindowBlur() {
      closeMenu();
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!menu.hidden) {
        closeMenu();
      } else {
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        menu.querySelectorAll(".cs-item").forEach(function (el) {
          el.removeAttribute("data-highlighted");
        });
        const checkEl = menu.querySelector(".cs-check");
        if (checkEl) {
          const highlightedItem = checkEl.closest(".cs-item");
          highlightedItem.setAttribute("data-highlighted", "");
          const itemsWrapper = menu.querySelector(".cs-menu-items-wrapper");
          if (itemsWrapper) {
            itemsWrapper.scrollTop = highlightedItem.offsetTop - itemsWrapper.clientHeight / 2 + highlightedItem.offsetHeight / 2;
          }
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("blur", onWindowBlur);
      }
    });

    menu.querySelectorAll(".cs-item").forEach(function (item) {
      item.addEventListener("click", function () {
        const labelEl = btn.querySelector(".cs-btn-label");
        const itemLabelEl = item.querySelector(".cs-item-label");
        if (labelEl && itemLabelEl) {
          labelEl.textContent = itemLabelEl.textContent;
        }
        menu.querySelectorAll(".cs-check").forEach(function (el) {
          el.remove();
        });
        item.insertAdjacentHTML("beforeend", csIcons.checkmark);
        onChange(item.dataset.value);
        closeMenu();
      });
      item.addEventListener("mouseenter", function () {
        menu.querySelectorAll(".cs-item").forEach(function (el) {
          el.removeAttribute("data-highlighted");
        });
        item.setAttribute("data-highlighted", "");
      });
      item.addEventListener("mouseleave", function () {
        item.removeAttribute("data-highlighted");
      });
    });
  }

  // Closes every open custom-select dropdown at once by invoking each bound
  // menu's own close function, which hides the menu and removes its
  // document/window listeners immediately (atomic cleanup).
  function closeAllDropdowns() {
    Object.keys(menuCloseHandlers).forEach(function (menuId) {
      menuCloseHandlers[menuId]();
    });
  }

  window.renderCustomSelect = renderCustomSelect;
  window.bindCustomSelect = bindCustomSelect;
  window.closeAllDropdowns = closeAllDropdowns;
})();
