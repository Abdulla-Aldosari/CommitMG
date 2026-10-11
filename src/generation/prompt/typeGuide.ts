// The commit type decision guide embedded in the system prompt.

import { DEFAULT_COMMIT_TYPES } from "../types";

// ===================== TYPE GUIDE =====================
// The fixed commit types with a full explanation paragraph for each one.
// Every paragraph must stay above MIN_TYPE_EXPLANATION chars (enforced by
// assertExamplesValid), so the model always receives a detailed, general
// decision guide instead of one-line hints. The explanations are generic
// on purpose: they apply to any project, with no special cases.
export const MIN_TYPE_EXPLANATION = 600;

export const TYPE_EXPLANATIONS: readonly (readonly [string, string])[] = [
  [
    "feat",
    "A new capability that users of the software can observe or use. Choose feat whenever the change adds something that did not exist before: a new command, a new option, a new panel, a new setting, a new function exposed through an interface, or a new behavior that end users can trigger. The key question is whether a user can notice the addition from outside the code - if a user can see, click, call, or configure something new, it is a feat. Small additions count as feat too, as long as they are user-visible; the size of the change does not matter, only its nature. Do not choose feat for changes that only move code around, only adjust formatting, only touch internals that users cannot perceive, or only modify documentation or tests. When the change combines a new capability with other kinds of work, lead with feat because the new capability is the headline of the commit, and describe the supporting work in the body rather than splitting the commit into several types.",
  ],
  [
    "fix",
    "Choose fix when the change repairs something that was not working correctly. The malfunction can be any deviation between what the code is supposed to do and what it actually does: a crash, an incorrect result, a missing output, a broken interaction, a regression, a case where the code never worked as intended, or a situation where existing behavior stopped happening because of some earlier mistake. The deciding question is whether the change makes something work that previously did not work - if yes, it is a fix, regardless of how small the change is or where the fault came from. Fix also covers restoring behavior that was accidentally lost or disabled. Do not choose fix for adding new behavior that never existed, for reorganizing code that already works, for pure formatting, or for documentation and test-only changes. When a change both repairs something and adds something new, ask which of the two is the main point of the change; if the repair is the reason the change exists, fix is the correct type.",
  ],
  [
    "perf",
    "Choose perf when the change makes existing behavior faster, lighter, or cheaper without altering what the behavior does. The improvement can show up as shorter execution time, lower memory usage, fewer network or disk operations, smaller bundle or artifact size, or reduced startup cost. The key question is whether the observable result of the code stays the same while the resources it consumes go down - if yes, it is perf, even when the gain is small. Perf changes often look like rewrites, and they usually do not add or remove features; the same inputs produce the same outputs, only more efficiently. Do not choose perf for a change that primarily adds a feature, repairs a bug, or cleans up code structure, even if it happens to run marginally faster as a side effect; judge the intent of the change, not its side effects. When an optimization is the stated goal of the change, perf is the type that communicates that goal to readers and to the changelog.",
  ],
  [
    "style",
    "Choose style when the change affects only the appearance or presentation of the code without changing what it does. Style covers formatting, indentation, spacing, line breaks, quotation style, comment decoration, renaming of identifiers to better names, sorting of imports or properties, and any cosmetic alignment with a style guide or a formatter. The deciding question is whether a reader of the code, or the running program, can detect any difference in behavior - if the behavior is byte-for-byte identical and only the written form changed, it is style. Style is the right type for the output of formatters and linters that only reorder or reformat, and for commits whose purpose is readability and consistency. Do not choose style when the change fixes a mistake, adds a capability, alters control flow, changes a value or a condition, or re-activates anything that had stopped working; those are functional changes with their own types, no matter how small they look.",
  ],
  [
    "refactor",
    "Choose refactor when the change reorganizes the internal structure of the code without changing its observable behavior. Refactors move code between files or functions, extract helpers, inline redundant layers, rename internals, replace data structures with equivalent ones, reduce duplication, or restructure control flow into a clearer shape. The key question is whether the software still does exactly the same things after the change - if a user or a test cannot tell the difference, it is a refactor. The motivation of a refactor is internal quality: readability, maintainability, testability, or preparation for future work. Do not choose refactor when the reorganization is a side effect of adding a feature or fixing a bug; lead with the functional type instead. Also do not use refactor for pure formatting (that is style) or for performance-motivated rewrites (that is perf). When behavior changes even slightly, the change is not a refactor.",
  ],
  [
    "docs",
    "Choose docs when the change touches documentation and nothing else: README files, user guides, project documentation, code comments that explain concepts to humans, changelog entries, and any text whose purpose is to inform people rather than to run. The deciding question is whether the change modifies how the software behaves - if the only thing that changed is text meant for humans, docs is the right type. This includes fixing typos in documentation, expanding explanations, adding examples or diagrams, and updating written descriptions to match the current behavior of the code. Do not choose docs for changes to code files that merely happen to adjust comments alongside functional edits; in that case the functional type wins. Also do not use docs for documentation files that are actually configuration, or for test files that happen to contain many comments.",
  ],
  [
    "test",
    "Choose test when the change is confined to tests and test infrastructure: adding, updating, removing, or fixing test cases, fixtures, snapshots, test helpers, test configuration, and anything else that exists only to verify the software. The deciding question is whether the change is executed as part of verification rather than as part of the product - if the change only affects how the software is checked, test is the right type. Test includes adding coverage for existing behavior, adjusting expectations after an intentional behavior change, and repairing tests that fail for reasons of their own. Do not choose test when the change also alters product code; if product code and its tests change together, lead with the type that describes the product change and mention the test updates in the body, because the product change is the headline of the commit.",
  ],
  [
    "chore",
    "Choose chore for routine maintenance that does not change product behavior, is not documentation, and is not part of the build or CI systems. Typical chores are updating or pinning dependencies, adjusting configuration files, housekeeping in the repository, tooling updates that have no user-visible effect, removing dead files, and small administrative changes. The deciding question is whether the change is worth recording but does not fit any of the functional or structural types - if it is necessary maintenance that users cannot perceive, chore is the right type. Chore is the honest label for work that keeps the project healthy without changing what the software does. Do not choose chore when the change adds a feature, fixes a bug, or modifies documentation, tests, build output, or pipeline behavior; those each have a more specific type that communicates more to readers and to the changelog. When in doubt between chore and a more specific type, prefer the specific type.",
  ],
  [
    "build",
    "Choose build when the change affects the build system itself: build scripts, bundlers, compiler configuration, module resolution, package scripts that produce the distributable artifact, and any tooling that turns source code into the shipped output. The deciding question is whether the change alters how the software is assembled rather than how it behaves - if the change is about producing, packaging, or compiling, build is the right type. This includes upgrading a bundler, adjusting compiler options, adding or removing build steps, and fixing packaging problems. Do not choose build for changes to the source code that the build then compiles; those use their functional types. Also do not use build for dependencies that the application consumes at runtime, or for pipeline automation that runs builds in the cloud (that is ci).",
  ],
  [
    "ci",
    "Choose ci when the change affects continuous integration or delivery automation: workflow files, pipeline definitions, job configuration, deployment scripts, and anything that runs on the automation platform rather than on a developer's machine. The deciding question is whether the change alters how the project is checked, built, or released automatically - if the change lives in the automation layer, ci is the right type. This includes adding or adjusting jobs, changing triggers, fixing pipeline failures, updating action versions, and modifying release automation. Do not choose ci for the code the pipeline tests or builds (those use their functional types), for local build configuration (that is build), or for repository documentation that describes the pipeline (that is docs). When a change touches both the automation and the product, lead with the product type and mention the automation in the body.",
  ],
  [
    "revert",
    "Choose revert when the change undoes a previous commit, restoring the codebase to the state it had before that commit. The message should name the commit being reverted and, in the body, explain why the undo was necessary. The deciding question is whether the change is primarily an undo of earlier work - if the intent is to take something back, revert is the right type. Reverts can be partial: a revert may restore some parts of a previous change while keeping others, as long as the dominant intent is undoing. Do not choose revert for a fresh fix that happens to remove code added earlier, for a rewrite that reimplements something differently, or for deletions that stand on their own merits; those have their own types. When a revert is combined with new work, separate the undo from the new work, or lead with revert and describe the new work in the body so the history stays readable.",
  ],
];

// The compact guide: the same types in the same order, each reduced to its
// deciding question and its most common boundary. About a quarter of the
// full guide's size, for users who trade some type accuracy for a smaller,
// faster prompt.
export const COMPACT_TYPE_EXPLANATIONS: readonly (readonly [string, string])[] = [
  ["feat", "a new capability users can see, call, or configure, however small. Lead with feat when a change mixes new capability with other work."],
  ["fix", "makes something work that did not work: a crash, a wrong result, a regression, lost behavior. If the repair is why the change exists, it is fix."],
  ["perf", "same observable result with fewer resources: faster, lighter, fewer operations. Judge the intent, not side effects."],
  ["style", "formatting or naming only; the program behaves byte-for-byte the same. Any change to a value, condition, or control flow is not style."],
  ["refactor", "internal restructuring with no observable change. Not when it serves a feature or fix, and not for formatting (style) or speed (perf)."],
  ["docs", "text for humans only: README, guides, explanatory comments. Comments edited alongside functional changes take the functional type."],
  ["test", "tests and test infrastructure only. When product code changes too, lead with the product type."],
  ["chore", "routine maintenance users cannot perceive: dependencies, config, housekeeping. Prefer a more specific type when one fits."],
  ["build", "how the software is assembled: build scripts, bundler, compiler options, packaging. Not runtime code, not CI pipelines."],
  ["ci", "automation that checks, builds, or releases on the CI platform: workflows, jobs, triggers. Not local build config (build)."],
  ["revert", "undoes an earlier commit; name it and say why. Not a fresh fix that happens to remove earlier code."],
];

export type TypeGuide = "full" | "compact";

// Renders the TYPE section for the project's allowed types: the accepted
// list, then one guide entry per allowed type the guide explains, either
// the full paragraph or the compact one-liner, in the project's order. A
// type the guide does not know (a project's own type) is only listed; a
// type the project does not allow is never explained, so the model is
// never taught a type the validation would reject.
export function typeSectionText(guide: TypeGuide = "full", types: readonly string[] = DEFAULT_COMMIT_TYPES): string {
  const explanations = new Map(guide === "compact" ? COMPACT_TYPE_EXPLANATIONS : TYPE_EXPLANATIONS);
  const explained = types.filter((type) => explanations.has(type));
  const entries =
    guide === "compact"
      ? explained.map((type) => `- ${type}: ${explanations.get(type)}`).join("\n")
      : explained.map((type) => `- ${type}:\n${explanations.get(type)}`).join("\n\n");
  const guideBlock =
    explained.length > 0
      ? `

How to Determine the Right Type:

${entries}`
      : "";
  return `=== TYPE ===

Accepted <type>:
${types.join(", ")}${guideBlock}`;
}
