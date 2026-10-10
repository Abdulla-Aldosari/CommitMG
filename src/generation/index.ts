// Public surface of the generation engine. The engine is vscode-free and
// silent: it never prints, never opens files, and reports failures by
// throwing. Provider, model, and transport selection belong to the caller,
// which passes a pre-built AiClient (see src/ai/aiClient.ts).
//
// Module map:
//   changes.ts                    git changes and the diff cap
//   evidence.ts                   old-file evidence within a budget
//   projectRules/commitlintRules  commitlint scopes, limits, scope map
//   projectRules/scopeMap         changed files -> scope entries
//   prompt/                       examples, type guide, prompt assembly
//   validation.ts                 deterministic post-generation checks
//   generate.ts                   end-to-end generation with one retry
//   preview.ts                    prompt preview without sending

export { COMMIT_STYLES, NO_CHANGES_ERROR, type CommitlintLimits, type CommitStyle, type ScopeMapEntry } from "./types";
export { buildEvidenceSections, type EvidenceFile } from "./evidence";
export { readAcceptedScopes, readCommitlintLimits, readScopeMap } from "./projectRules/commitlintRules";
export { resolveScopesForFiles } from "./projectRules/scopeMap";
export { assertExamplesValid } from "./prompt/examples";
export { buildPrompt } from "./prompt/buildPrompt";
export { validateCommitMessage, validateHeaderMeta } from "./validation";
export { generateCommitMessage, type CommitMessageObserver } from "./generate";
export { buildPromptForRepo, formatPromptPreview } from "./preview";
