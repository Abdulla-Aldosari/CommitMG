// Tests for the Speed & Context settings: presets, the options and params a
// stored snapshot produces, and where a value comes from.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "mocha";
import { modelSupport } from "../src/ai/params/profileRules";
import { DEFAULT_GENERATION_OPTIONS } from "../src/generation/options";
import {
  isUserSettingKey,
  isValidUserSettingValue,
  optionsFromSettings,
  paramsFromSettings,
  planSettingEdit,
  planStoredEdit,
  PRESET_KNOBS,
  sameSettingValue,
  settingSource,
  settingValueToStore,
  styleForButton,
  USER_SETTING_DEFAULTS,
  USER_SETTING_KEYS,
  timeoutMsFromSettings,
  writeLayerForEdit,
  type SettingSource,
  type UserSettingKey,
} from "../src/settings/userSettings";

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
    assert.deepEqual(paramsFromSettings(USER_SETTING_DEFAULTS), {});
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
    assert.equal(isValidUserSettingValue("generation.timeoutSeconds", 600), true);
    assert.equal(isValidUserSettingValue("generation.timeoutSeconds", 601), false);
  });
});

describe("isValidUserSettingValue", () => {
  it("accepts only values of the right type and range", () => {
    assert.equal(isValidUserSettingValue("context.preset", "fast"), true);
    assert.equal(isValidUserSettingValue("context.preset", "turbo"), false);
    assert.equal(isValidUserSettingValue("context.includeEvidence", "true"), false);
    assert.equal(isValidUserSettingValue("context.diffBudget", 24000), true);
    assert.equal(isValidUserSettingValue("context.diffBudget", 100), false);
    assert.equal(isValidUserSettingValue("context.diffBudget", 24000.5), false);
    assert.equal(isValidUserSettingValue("model.reasoning", "auto"), true);
    assert.equal(isValidUserSettingValue("model.temperature", null), true);
    assert.equal(isValidUserSettingValue("model.temperature", 3), false);
  });

  it("accepts only the offered context line counts", () => {
    assert.equal(isValidUserSettingValue("context.diffContextLines", 5), true);
    assert.equal(isValidUserSettingValue("context.diffContextLines", 4), false);
    assert.equal(isValidUserSettingValue("context.ignoreWhitespace", true), true);
  });

  it("accepts only clean, distinct exclude patterns", () => {
    assert.equal(isValidUserSettingValue("context.excludePatterns", ["*.lock", "dist/**"]), true);
    assert.equal(isValidUserSettingValue("context.excludePatterns", ["*.lock", "*.lock"]), false);
    assert.equal(isValidUserSettingValue("context.excludePatterns", [":(top)x"]), false);
    assert.equal(isValidUserSettingValue("context.excludePatterns", "*.lock"), false);
  });

  it("rejects keys that are not speed settings", () => {
    assert.equal(isUserSettingKey("aiModelId"), false);
    assert.equal(isUserSettingKey("context.diffBudget"), true);
  });
});

describe("planSettingEdit", () => {
  const asRecord = (writes: ReturnType<typeof planSettingEdit>) => Object.fromEntries(writes.map((write) => [write.key, write.value]));

  it("writes the edited key alone under custom", () => {
    assert.deepEqual(planSettingEdit({ "context.preset": "custom" }, "context.diffBudget", 9000), [{ key: "context.diffBudget", value: 9000 }]);
  });

  it("switches a named preset to custom and keeps its other knobs", () => {
    assert.deepEqual(asRecord(planSettingEdit({ "context.preset": "fast" }, "context.diffBudget", 9000)), {
      ...knobSettings(PRESET_KNOBS.fast),
      "context.diffBudget": 9000,
      "context.preset": "custom",
    });
  });

  it("copies the current preset when custom is chosen", () => {
    assert.deepEqual(asRecord(planSettingEdit({}, "context.preset", "custom")), { ...knobSettings(PRESET_KNOBS.balanced), "context.preset": "custom" });
  });

  it("writes the preset after every knob", () => {
    for (const writes of [
      planSettingEdit({ "context.preset": "fast" }, "context.preset", "custom"),
      planSettingEdit({ "context.preset": "thorough" }, "prompt.typeGuide", "compact"),
    ]) {
      assert.equal(writes.length, 6);
      assert.deepEqual(writes[writes.length - 1], { key: "context.preset", value: "custom" });
      assert.equal(writes.filter((write) => write.key === "context.preset").length, 1);
    }
  });

  it("leaves settings outside the presets alone", () => {
    assert.deepEqual(planSettingEdit({ "context.preset": "fast" }, "context.untrackedMaxFiles", 5), [{ key: "context.untrackedMaxFiles", value: 5 }]);
    assert.deepEqual(planSettingEdit({ "context.preset": "fast" }, "context.preset", "thorough"), [{ key: "context.preset", value: "thorough" }]);
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

  for (const key of USER_SETTING_KEYS) {
    it(`declares commitmg.${key} with the same default`, () => {
      assert.ok(declared[`commitmg.${key}`], `commitmg.${key} is missing from package.json`);
      assert.deepEqual(declared[`commitmg.${key}`].default, USER_SETTING_DEFAULTS[key]);
    });
  }
});

describe("sameSettingValue", () => {
  it("compares scalars, null, and arrays by value", () => {
    assert.equal(sameSettingValue(3, 3), true);
    assert.equal(sameSettingValue(null, null), true);
    assert.equal(sameSettingValue(null, 0), false);
    assert.equal(sameSettingValue(["a", "b"], ["a", "b"]), true);
    assert.equal(sameSettingValue(["a", "b"], ["b", "a"]), false);
    assert.equal(sameSettingValue([], ["a"]), false);
    assert.equal(sameSettingValue([], undefined), false);
  });
});

describe("settingSource", () => {
  it("reports the most specific layer that holds a value", () => {
    assert.equal(settingSource({ defaultValue: 0, globalValue: 1, workspaceValue: 2 }), "workspace");
    assert.equal(settingSource({ defaultValue: true, workspaceValue: false }), "workspace");
    assert.equal(settingSource({ defaultValue: true, globalValue: false }), "user");
    assert.equal(settingSource({}), "default");
    assert.equal(settingSource(undefined), "default");
  });

  it("counts a workspace value even when it repeats the default", () => {
    assert.equal(settingSource({ defaultValue: 5, workspaceValue: 5 }), "workspace");
    assert.equal(settingSource({ defaultValue: 5, globalValue: 7, workspaceValue: 5 }), "workspace");
  });

  it("treats a user value that repeats the default as unset", () => {
    assert.equal(settingSource({ defaultValue: 5, globalValue: 5 }), "default");
    assert.equal(settingSource({ defaultValue: null, globalValue: null }), "default");
    assert.equal(settingSource({ defaultValue: ["a"], globalValue: ["a"] }), "default");
    assert.equal(settingSource({ defaultValue: ["a"], globalValue: ["a", "b"] }), "user");
  });
});

describe("writeLayerForEdit", () => {
  it("writes to the workspace when it defines any setting of the edit", () => {
    assert.equal(writeLayerForEdit(["workspace"]), "workspace");
    assert.equal(writeLayerForEdit(["default", "user", "workspace"]), "workspace");
  });

  it("writes to the user settings otherwise", () => {
    assert.equal(writeLayerForEdit(["user"]), "user");
    assert.equal(writeLayerForEdit(["default", "user"]), "user");
    assert.equal(writeLayerForEdit([]), "user");
  });
});

describe("settingValueToStore", () => {
  it("removes a user value that repeats the default", () => {
    assert.equal(settingValueToStore("user", 24000, 24000), undefined);
    assert.equal(settingValueToStore("user", null, null), undefined);
    assert.equal(settingValueToStore("user", ["a"], ["a"]), undefined);
  });

  it("keeps a user value that differs from the default", () => {
    assert.equal(settingValueToStore("user", 9000, 24000), 9000);
    assert.deepEqual(settingValueToStore("user", ["^-"], []), ["^-"]);
    assert.equal(settingValueToStore("user", 9000, undefined), 9000);
  });

  it("keeps a workspace value even when it repeats the default", () => {
    assert.equal(settingValueToStore("workspace", 24000, 24000), 24000);
    assert.equal(settingValueToStore("workspace", null, null), null);
  });
});

describe("planStoredEdit", () => {
  const sources = (bySetting: Partial<Record<UserSettingKey, SettingSource>>) => (key: UserSettingKey) => ({
    source: bySetting[key] ?? "default",
    defaultValue: USER_SETTING_DEFAULTS[key],
  });

  it("writes a single setting to the layer it comes from", () => {
    assert.deepEqual(planStoredEdit({ "context.preset": "custom" }, "context.diffBudget", 9000, sources({ "context.diffBudget": "workspace" })), [
      { key: "context.diffBudget", layer: "workspace", value: 9000 },
    ]);
    assert.deepEqual(planStoredEdit({ "context.preset": "custom" }, "context.diffBudget", 9000, sources({ "context.diffBudget": "user" })), [
      { key: "context.diffBudget", layer: "user", value: 9000 },
    ]);
  });

  it("sends a whole preset switch to the workspace when the preset is stored there", () => {
    const writes = planStoredEdit({ "context.preset": "fast" }, "context.diffBudget", 9000, sources({ "context.preset": "workspace" }));
    assert.equal(writes.length, 6);
    assert.ok(writes.every((write) => write.layer === "workspace"));
    assert.deepEqual(
      writes.map((write) => write.key),
      [...writes.slice(0, 5).map((write) => write.key), "context.preset"],
    );
    assert.equal(writes[5].value, "custom");
  });

  it("keeps a workspace preset switch complete even when a value equals the default", () => {
    const writes = planStoredEdit({ "context.preset": "balanced" }, "context.diffBudget", 9000, sources({ "context.preset": "workspace" }));
    const balancedValue = writes.find((write) => write.key === "context.evidenceBudget");
    assert.equal(balancedValue?.value, USER_SETTING_DEFAULTS["context.evidenceBudget"]);
  });

  it("drops the values that repeat a default when a user-layer preset switch is written", () => {
    const writes = planStoredEdit({ "context.preset": "balanced" }, "context.diffBudget", 9000, sources({}));
    assert.ok(writes.every((write) => write.layer === "user"));
    assert.equal(writes.find((write) => write.key === "context.evidenceBudget")?.value, undefined);
    assert.equal(writes.find((write) => write.key === "context.diffBudget")?.value, 9000);
    assert.equal(writes[writes.length - 1].key, "context.preset");
    assert.equal(writes[writes.length - 1].value, "custom");
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

describe("styleForButton", () => {
  it("generates with a chosen detail level", () => {
    assert.equal(styleForButton("medium"), "medium");
    assert.equal(styleForButton("titleOnly"), "titleOnly");
  });

  it("asks for Ask every time and for anything malformed", () => {
    assert.equal(styleForButton("ask"), null);
    assert.equal(styleForButton("huge"), null);
    assert.equal(styleForButton(undefined), null);
  });

  it("accepts only the listed detail levels", () => {
    assert.equal(isValidUserSettingValue("format.defaultDetail", "ask"), true);
    assert.equal(isValidUserSettingValue("format.defaultDetail", "short"), true);
    assert.equal(isValidUserSettingValue("format.defaultDetail", "tiny"), false);
  });
});
