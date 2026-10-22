// Entry point of the settings webview's logic bundle. Everything exported
// here is pure (no DOM, no VS Code API) and reaches the webview scripts as
// window.CommitMgSettingsLogic (see scripts/bundle.js). Each module is
// tested directly by mocha.

export { classifyBaseUrl, type BaseUrlStatus } from "./baseUrl";
export { normalizeAdditionalInstructions } from "../generation/options";
export { addPatternProblem } from "./excludePatterns";
export { addExcludedScopeProblem, scopesNote } from "./excludedScopes";
export { formatExamples, formatExampleHtml, type FormatExample, type FormatExampleInput } from "./formatExamples";
export { reasoningView, type ReasoningView } from "./modelParams";
export { parseNumberInput, type NumberParseResult, type NumberRules } from "./numberField";
export { promptSizeKey, promptSizeView, type PromptSizeResult, type PromptSizeView } from "./promptSize";
export { rulesSourceView, type RulesSourceView } from "./rulesSource";
export { addTypeProblem, rowsToScopes, scopeRowsProblems, scopesToRows, type ScopeRow } from "./rulesTable";
export { clampIndex, fractionFor, indexAfterKey, indexAtFraction, initialIndex } from "./stepSlider";
