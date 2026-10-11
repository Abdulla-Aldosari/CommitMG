// Public surface of the generation engine. The engine is vscode-free and
// silent: it never prints, never opens files, and reports failures by
// throwing. Provider, model, and transport selection belong to the caller,
// which passes a pre-built AiClient (see src/ai/aiClient.ts).
//
// Module map:
//   options.ts                    prompt size knobs and their defaults
//   changes.ts                    git changes and the diff cap
//   evidence.ts                   old-file evidence within a budget
//   prepare.ts                    rules, changes, evidence, and prompts
//   projectRules/commitlintLoader isolated-process commitlint config loading
//   projectRules/commitlintRules  commitlint scopes, limits, scope map
//   projectRules/projectRules     the rules one generation runs with
//   projectRules/scopeMap         changed files -> scope entries
//   prompt/                       examples, type guide, prompt assembly
//   validation.ts                 deterministic post-generation checks
//   generate.ts                   end-to-end generation with one retry
//   preview.ts                    prompt preview without sending

export { COMMIT_STYLES, DEFAULT_COMMIT_TYPES, NO_CHANGES_ERROR, type CommitlintLimits, type CommitStyle, type ScopeMapEntry } from "./types";
export { DEFAULT_GENERATION_OPTIONS, GENERATION_OPTION_RANGES, normalizeOptions, type GenerationOptions } from "./options";
export { buildEvidenceSections, type EvidenceFile } from "./evidence";
export { acceptedScopesFrom, limitsFrom, scopeMapFrom, typesFrom } from "./projectRules/commitlintRules";
export {
  COMMITLINT_CONFIG_FILE,
  COMMITLINT_LOAD_TIMEOUT_MS,
  findCommitlintConfig,
  loadCommitlintConfig,
  parseLoaderResult,
  type CommitlintConfigData,
  type CommitlintConfigResult,
} from "./projectRules/commitlintLoader";
export { loadProjectRules, type ProjectRules, type RulesSource } from "./projectRules/projectRules";
export { loadRulesFile, readRulesFileText } from "./projectRules/rulesFile";
export { parseRulesFile, RULES_FILE, RULES_LIMIT_MAX, RULES_LIMIT_MIN, type RulesFileData, type RulesFileScope } from "./projectRules/rulesFileSchema";
export { resolveScopesForFiles } from "./projectRules/scopeMap";
export { assertExamplesValid } from "./prompt/examples";
export { buildPrompt } from "./prompt/buildPrompt";
export { validateCommitMessage, validateHeaderMeta } from "./validation";
export {
  generateCommitMessage,
  GenerationCancelledError,
  REQUEST_TIMEOUT_MS,
  type CommitMessageObserver,
  type GenerationAttempt,
  type GenerationRunOptions,
  type GenerationStage,
} from "./generate";
export { buildPromptForRepo, formatPromptPreview } from "./preview";
