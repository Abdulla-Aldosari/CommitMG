// Prompt preview: builds the exact prompts for a repository without
// contacting any provider.

import type { GenerationOptions } from "./options";
import { prepareGeneration } from "./prepare";
import type { CommitStyle } from "./types";

// ===================== PROMPT PREVIEW =====================

// Builds the exact system and user prompts that would be sent for the given
// repository, without contacting any provider. Used by the standalone prompt
// preview command (a read-only developer tool); generation itself always
// builds fresh prompts internally. Throws for the same reasons generation
// would fail early: unknown style or no changes to describe.
export async function buildPromptForRepo(repoRoot: string, style: CommitStyle, options?: Partial<GenerationOptions>): Promise<{ systemPrompt: string; userPrompt: string }> {
  const { systemPrompt, userPrompt } = await prepareGeneration(repoRoot, style, options);
  return { systemPrompt, userPrompt };
}

// Renders both prompts into one human-readable document for the preview
// tab. Pure text formatting; no VS Code involvement. Markdown headings are
// emitted so the preview reads nicely in an untitled editor tab.
export function formatPromptPreview(style: CommitStyle, systemPrompt: string, userPrompt: string): string {
  return [
    "# Commit MG - Prompt Preview (This section is not sent to the AI model)",
    "",
    `Style: ${style}`,
    `System prompt: ${systemPrompt.length} characters`,
    `User prompt: ${userPrompt.length} characters`,
    "",
    "## System Prompt",
    "",
    systemPrompt,
    "",
    "## User Prompt",
    "",
    userPrompt,
    "",
  ].join("\n");
}
