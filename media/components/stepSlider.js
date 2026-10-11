/*-------------------------------------------------
 * Commit MG - VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Step slider: a knob that snaps to an ordered list of values. Click the bar
// to snap, drag the knob, or use the arrow, Page, Home and End keys. The
// value math lives in window.CommitMgSettingsLogic (src/webview/stepSlider.ts).
//
// createStepSlider(root, config) fills an empty container.
//
// config:
//   title           - name shown beside the current value (also the
//                     accessible name of the knob)
//   values          - ordered list of { value, label }
//   value           - the current value; unknown values start on the first
//   recommended     - optional value to highlight with "Recommended"
//   startLabel      - optional label above the left end (e.g. "Faster")
//   endLabel        - optional label above the right end (e.g. "Smarter")
//   disabled        - initial disabled state (default false)
//   commitOnRelease - when true, a drag emits once on release
//   onChange        - optional callback onChange(value, index) after a user
//                     change
//
// Output: onChange(value, index), and a "change" CustomEvent on root with
// detail = { value, index }. setValue() and setValues() never emit, so a
// state refresh from the host cannot echo back as a user change.
//
// Returns { getValue, setValue, setValues, setDisabled }:
//   setValue(value)                       - move the knob to an existing value
//   setValues(values, value, recommended) - replace the value list (e.g. the
//                                           levels the chosen model offers)

(function () {
  const logic = () => window.CommitMgSettingsLogic;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function createStepSlider(root, config) {
    let values = config.values;
    let currentIndex = logic().initialIndex(
      values.map((item) => item.value),
      config.value,
    );
    let recommended = config.recommended ?? null;
    let disabled = Boolean(config.disabled);
    let dragging = false;
    let dragStartIndex = currentIndex;
    const commitOnRelease = config.commitOnRelease === true;

    root.classList.add("step-slider");

    const header = element("div", "step-slider-header");
    const valueText = element("span", "step-slider-value");
    valueText.setAttribute("aria-hidden", "true");
    header.append(element("span", "step-slider-title", config.title), valueText);
    root.append(header);

    if (config.startLabel || config.endLabel) {
      const labels = element("div", "step-slider-labels");
      labels.append(element("span", "step-slider-label", config.startLabel || ""), element("span", "step-slider-label", config.endLabel || ""));
      root.append(labels);
    }

    const wrapper = element("div", "step-slider-wrapper");
    const track = element("div", "step-slider-track");
    const knob = element("button", "step-slider-knob");
    knob.type = "button";
    knob.setAttribute("role", "slider");
    knob.setAttribute("aria-label", config.title);
    wrapper.append(element("div", "step-slider-progress"), track);
    root.append(wrapper);

    const count = () => values.length;
    const positionFor = (index) => `${logic().fractionFor(index, count()) * 100}%`;

    // Rebuilds the anchors, the recommended marker and the knob; runs on
    // creation and whenever the value list changes.
    function buildTrack() {
      track.replaceChildren();
      const recommendedIndex = recommended === null ? -1 : values.findIndex((item) => item.value === recommended);
      values.forEach((_item, index) => {
        const anchor = element("span", index === recommendedIndex ? "step-slider-anchor recommended" : "step-slider-anchor");
        anchor.style.left = positionFor(index);
        track.append(anchor);
      });
      root.classList.toggle("has-recommended", recommendedIndex >= 0);
      if (recommendedIndex >= 0) {
        const marker = element("span", "step-slider-recommended", "Recommended");
        marker.style.left = positionFor(recommendedIndex);
        track.append(marker);
      }
      knob.setAttribute("aria-valuemin", "0");
      knob.setAttribute("aria-valuemax", String(Math.max(0, count() - 1)));
      track.append(knob);
    }

    // Crossfades the value text: the old label leaves, the new one enters.
    function showValueText(text, animate) {
      const current = valueText.lastElementChild;
      if (current && current.textContent === text) {
        return;
      }
      if (current && !animate) {
        valueText.replaceChildren();
      } else if (current) {
        current.classList.remove("enter");
        current.classList.add("exit");
        current.addEventListener("animationend", () => current.remove(), { once: true });
      }
      const entering = element("span", "step-slider-value-text", text);
      if (current && animate) {
        entering.classList.add("enter");
        entering.addEventListener("animationend", () => entering.classList.remove("enter"), { once: true });
      }
      valueText.append(entering);
    }

    function render(animate) {
      const item = values[currentIndex];
      const label = item ? item.label : "";
      showValueText(label, animate);
      knob.style.left = positionFor(currentIndex);
      wrapper.style.setProperty("--step-slider-fraction", String(logic().fractionFor(currentIndex, count())));
      knob.setAttribute("aria-valuenow", String(currentIndex));
      knob.setAttribute("aria-valuetext", label);
      root.classList.toggle("is-disabled", disabled);
      knob.disabled = disabled;
    }

    function emitChange() {
      const item = values[currentIndex];
      config.onChange?.(item.value, currentIndex);
      root.dispatchEvent(new CustomEvent("change", { detail: { value: item.value, index: currentIndex } }));
    }

    // Moves the knob on a user action; emits unless a deferred drag is in
    // progress.
    function moveTo(index) {
      const next = logic().clampIndex(index, count());
      if (next === currentIndex) {
        return;
      }
      currentIndex = next;
      render(true);
      if (!(commitOnRelease && dragging)) {
        emitChange();
      }
    }

    function indexAtPointer(clientX) {
      const rect = track.getBoundingClientRect();
      return logic().indexAtFraction(rect.width > 0 ? (clientX - rect.left) / rect.width : 0, count());
    }

    function endDrag() {
      knob.classList.remove("dragging");
      if (!dragging) {
        return;
      }
      dragging = false;
      if (commitOnRelease && currentIndex !== dragStartIndex) {
        emitChange();
      }
    }

    // Pressing the bar snaps the knob to the nearest value; the knob's own
    // presses start a drag instead.
    wrapper.addEventListener("pointerdown", (event) => {
      if (disabled || event.target.closest(".step-slider-knob")) {
        return;
      }
      moveTo(indexAtPointer(event.clientX));
      knob.focus();
    });

    knob.addEventListener("pointerdown", (event) => {
      if (disabled) {
        return;
      }
      event.preventDefault();
      knob.setPointerCapture(event.pointerId);
      knob.classList.add("dragging");
      dragging = true;
      dragStartIndex = currentIndex;
    });

    knob.addEventListener("pointermove", (event) => {
      if (knob.hasPointerCapture(event.pointerId)) {
        moveTo(indexAtPointer(event.clientX));
      }
    });

    knob.addEventListener("pointerup", (event) => {
      if (knob.hasPointerCapture(event.pointerId)) {
        knob.releasePointerCapture(event.pointerId);
      }
      endDrag();
    });
    knob.addEventListener("pointercancel", endDrag);

    knob.addEventListener("keydown", (event) => {
      if (disabled) {
        return;
      }
      const next = logic().indexAfterKey(event.key, currentIndex, count());
      if (next === null) {
        return;
      }
      event.preventDefault();
      moveTo(next);
    });

    buildTrack();
    render(false);

    return {
      getValue: () => (values[currentIndex] ? values[currentIndex].value : undefined),
      setValue(value) {
        const index = values.findIndex((item) => item.value === value);
        if (index >= 0 && index !== currentIndex) {
          currentIndex = index;
          render(true);
        }
      },
      setValues(nextValues, value, nextRecommended = recommended) {
        values = nextValues;
        recommended = nextRecommended ?? null;
        currentIndex = logic().initialIndex(
          values.map((item) => item.value),
          value,
        );
        buildTrack();
        render(false);
      },
      setDisabled(nextDisabled) {
        disabled = Boolean(nextDisabled);
        render(false);
      },
    };
  }

  window.CommitMgComponents = window.CommitMgComponents || {};
  window.CommitMgComponents.createStepSlider = createStepSlider;
})();
