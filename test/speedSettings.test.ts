// Tests for the Speed & Context settings: presets, the options and params a
// stored snapshot produces, and where a value comes from.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "mocha";
import { modelSupport } from "../src/ai/params/profileRules";
import { DEFAULT_GENERATION_OPTIONS } from "../src/generation/options";
import {
  isSpeedSettingKey,
  isValidSpeedValue,
  optionsFromSettings,
  paramsFromSettings,
  planSpeedEdit,
  PRESET_KNOBS,
  settingSource,
  SPEED_SETTING_DEFAULTS,
  SPEED_SETTING_KEYS,
  timeoutMsFromSettings,
} from "../src/settings/speedSettings";

describe("optionsFromSettings", () => {
  it("uses the default preset when nothing is stored", () => {
    assert.deepEqual(optionsFromSettings({}), { ...DEFAULT_GENERATION_OPTIONS, ...PRESET_KNOBS.balanced });
  });

  it("keeps the previous behavior under the thorough preset", () => {
    assert.deepEqual(optionsFromSettings({ "context.preset": "thorough" }), DEFAULT_GENERATION_OPTIONS);
  });

  it("ignores the individual values under a named preset and reads them under custom", () => {
    const stored = { "context.includeEvidence": true, "context.evidenceBudget": 30000, "context.diffBudget": 9000 };
    assert.equal(optionsFromSettings({ ...stored, "context.preset": "fast" }).includeEvidence, false);
    assert.deepEqual(optionsFromSettings({ ...stored, "context.preset": "custom" }), {
      ...DEFAULT_GENERATION_OPTIONS,
      includeEvidence: true,
      evidenceBudget: 30000,
      diffBudget: 9000,
    });
  });

  it("falls back to the default preset for an unknown preset name", () => {
    const raw = { "context.preset": "turbo" } as unknown as Parameters<typeof optionsFromSettings>[0];
    assert.deepEqual(optionsFromSettings(raw), optionsFromSettings({}));
  });

  it("applies the untracked-file caps under every preset", () => {
    assert.equal(optionsFromSettings({ "context.preset": "fast", "context.untrackedMaxFiles": 5 }).untrackedMaxFiles, 5);
  });
});

describe("paramsFromSettings", () => {
  it("sends nothing for Auto", () => {
    assert.deepEqual(paramsFromSettings(SPEED_SETTING_DEFAULTS), {});
  });

  it("passes chosen values through", () => {
    assert.deepEqual(paramsFromSettings({ "model.reasoning": "high", "model.temperature": 0, "model.maxOutputTokens": 4096 }), {
      reasoning: "high",
      temperature: 0,
      maxOutputTokens: 4096,
    });
  });

  it("drops unknown levels and out-of-range numbers", () => {
    const raw = { "model.reasoning": "extreme", "model.temperature": 7, "model.maxOutputTokens": 10 } as unknown as Parameters<typeof paramsFromSettings>[0];
    assert.deepEqual(paramsFromSettings(raw), {});
  });
});

describe("timeoutMsFromSettings", () => {
  it("converts seconds and falls back to the default for bad values", () => {
    assert.equal(timeoutMsFromSettings({ "generation.timeoutSeconds": 45 }), 45000);
    assert.equal(timeoutMsFromSettings({}), 120000);
    assert.equal(timeoutMsFromSettings({ "generation.timeoutSeconds": 5 }), 120000);
    assert.equal(isValidSpeedValue("generation.timeoutSeconds", 600), true);
    assert.equal(isValidSpeedValue("generation.timeoutSeconds", 601), false);
  });
});

describe("isValidSpeedValue", () => {
  it("accepts only values of the right type and range", () => {
    assert.equal(isValidSpeedValue("context.preset", "fast"), true);
    assert.equal(isValidSpeedValue("context.preset", "turbo"), false);
    assert.equal(isValidSpeedValue("context.includeEvidence", "true"), false);
    assert.equal(isValidSpeedValue("context.diffBudget", 24000), true);
    assert.equal(isValidSpeedValue("context.diffBudget", 100), false);
    assert.equal(isValidSpeedValue("context.diffBudget", 24000.5), false);
    assert.equal(isValidSpeedValue("model.reasoning", "auto"), true);
    assert.equal(isValidSpeedValue("model.temperature", null), true);
    assert.equal(isValidSpeedValue("model.temperature", 3), false);
  });

  it("accepts only the offered context line counts", () => {
    assert.equal(isValidSpeedValue("context.diffContextLines", 5), true);
    assert.equal(isValidSpeedValue("context.diffContextLines", 4), false);
    assert.equal(isValidSpeedValue("context.ignoreWhitespace", true), true);
  });

  it("accepts only clean, distinct exclude patterns", () => {
    assert.equal(isValidSpeedValue("context.excludePatterns", ["*.lock", "dist/**"]), true);
    assert.equal(isValidSpeedValue("context.excludePatterns", ["*.lock", "*.lock"]), false);
    assert.equal(isValidSpeedValue("context.excludePatterns", [":(top)x"]), false);
    assert.equal(isValidSpeedValue("context.excludePatterns", "*.lock"), false);
  });

  it("rejects keys that are not speed settings", () => {
    assert.equal(isSpeedSettingKey("aiModelId"), false);
    assert.equal(isSpeedSettingKey("context.diffBudget"), true);
  });
});

describe("planSpeedEdit", () => {
  const asRecord = (writes: ReturnType<typeof planSpeedEdit>) => Object.fromEntries(writes.map((write) => [write.key, write.value]));

  it("writes the edited key alone under custom", () => {
    assert.deepEqual(planSpeedEdit({ "context.preset": "custom" }, "context.diffBudget", 9000), [{ key: "context.diffBudget", value: 9000 }]);
  });

  it("switches a named preset to custom and keeps its other knobs", () => {
    assert.deepEqual(asRecord(planSpeedEdit({ "context.preset": "fast" }, "context.diffBudget", 9000)), {
      ...knobSettings(PRESET_KNOBS.fast),
      "context.diffBudget": 9000,
      "context.preset": "custom",
    });
  });

  it("copies the current preset when custom is chosen", () => {
    assert.deepEqual(asRecord(planSpeedEdit({}, "context.preset", "custom")), { ...knobSettings(PRESET_KNOBS.balanced), "context.preset": "custom" });
  });

  it("writes the preset after every knob", () => {
    for (const writes of [
      planSpeedEdit({ "context.preset": "fast" }, "context.preset", "custom"),
      planSpeedEdit({ "context.preset": "thorough" }, "prompt.typeGuide", "compact"),
    ]) {
      assert.equal(writes.length, 6);
      assert.deepEqual(writes[writes.length - 1], { key: "context.preset", value: "custom" });
      assert.equal(writes.filter((write) => write.key === "context.preset").length, 1);
    }
  });

  it("leaves settings outside the presets alone", () => {
    assert.deepEqual(planSpeedEdit({ "context.preset": "fast" }, "context.untrackedMaxFiles", 5), [{ key: "context.untrackedMaxFiles", value: 5 }]);
    assert.deepEqual(planSpeedEdit({ "context.preset": "fast" }, "context.preset", "thorough"), [{ key: "context.preset", value: "thorough" }]);
  });
});

function knobSettings(knobs: (typeof PRESET_KNOBS)[keyof typeof PRESET_KNOBS]) {
  return {
    "context.includeEvidence": knobs.includeEvidence,
    "context.evidenceBudget": knobs.evidenceBudget,
    "context.diffBudget": knobs.diffBudget,
    "context.diffContextLines": knobs.diffContextLines,
    "prompt.typeGuide": knobs.typeGuide,
  };
}

describe("package.json declares every speed setting", () => {
  // VS Code applies the package.json default when nothing is stored, so it
  // must match the default the extension assumes.
  const declared = (
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { contributes: { configuration: { properties: Record<string, { default: unknown }> } } }
  ).contributes.configuration.properties;

  for (const key of SPEED_SETTING_KEYS) {
    it(`declares commitmg.${key} with the same default`, () => {
      assert.ok(declared[`commitmg.${key}`], `commitmg.${key} is missing from package.json`);
      assert.deepEqual(declared[`commitmg.${key}`].default, SPEED_SETTING_DEFAULTS[key]);
    });
  }
});

describe("settingSource", () => {
  it("reports the most specific layer that holds a value", () => {
    assert.equal(settingSource({ globalValue: 1, workspaceValue: 2, workspaceFolderValue: 3 }), "workspaceFolder");
    assert.equal(settingSource({ globalValue: 1, workspaceValue: 2 }), "workspace");
    assert.equal(settingSource({ globalValue: false }), "user");
    assert.equal(settingSource({}), "default");
    assert.equal(settingSource(undefined), "default");
  });
});

describe("modelSupport", () => {
  it("lists the reasoning levels a model offers, in order", () => {
    assert.deepEqual(modelSupport("mistral", "mistral-small-latest"), { known: true, reasoningLevels: ["off", "high"], temperature: "onlyWhenReasoningOff" });
    assert.deepEqual(modelSupport("openai", "gpt-4o-mini").reasoningLevels, []);
  });

  it("offers nothing optional for a model no profile knows", () => {
    assert.deepEqual(modelSupport("openai", "gpt-9-future"), { known: false, reasoningLevels: [], temperature: "unsupported" });
  });
});
