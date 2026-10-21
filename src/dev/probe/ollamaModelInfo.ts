// Measures one local Ollama model's capabilities from its own metadata
// (POST /api/show) instead of a request matrix: Ollama describes each
// model's thinking controls itself, so one local call replaces a whole
// probe run. The transcription (profileFromOllamaModelInfo) is pure and
// unit-tested; fetchOllamaModelInfo only does transport.

import type { StoredModelProfile } from "../../ai/params/capabilityStore";
import type { ReasoningLevel } from "../../ai/params/generationParams";
import { fetchJson } from "../../ai/providers/httpClient";

export interface OllamaThinkingInfo {
  values?: Array<boolean | string>;
  default?: boolean | string;
}

export interface OllamaModelInfo {
  capabilities?: string[];
  thinking?: OllamaThinkingInfo;
}

export async function fetchOllamaModelInfo(baseUrl: string, modelId: string): Promise<OllamaModelInfo> {
  return (await fetchJson(`${baseUrl}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelId }),
  })) as OllamaModelInfo;
}

const NAMED_LEVELS: readonly ReasoningLevel[] = ["low", "medium", "high", "max"];

// Transcribes the /api/show metadata into a stored profile. Ollama accepts
// temperature and an output cap (num_predict) on every model, so those are
// always known; the reasoning control comes from the thinking metadata:
// absent or values [false] means no thinking control, booleans map to
// off/on (think false/true), and model-defined strings map to the neutral
// level they name.
export function profileFromOllamaModelInfo(modelId: string, info: OllamaModelInfo): StoredModelProfile | null {
  if (typeof info !== "object" || info === null) {
    return null;
  }
  const thinking = info.thinking;
  const levels: Partial<Record<ReasoningLevel, string | number | boolean>> = {};
  let onByDefault = false;

  if (thinking) {
    const values = thinking.values ?? [];
    const hasNamedLevels = values.some((value) => typeof value === "string");
    // values [false] alone means no thinking support; an off level is only
    // recorded when the model actually has a thinking control to turn off.
    const supportsThinking = values.includes(true) || hasNamedLevels;
    for (const value of values) {
      if (value === false && supportsThinking) {
        levels.off = false;
      } else if (value === true && !hasNamedLevels) {
        // Boolean on/off: "on" is offered as the single low level, so the
        // settings UI shows Off / Low instead of five identical options.
        levels.low = true;
      } else if (typeof value === "string" && (NAMED_LEVELS as readonly string[]).includes(value)) {
        levels[value as ReasoningLevel] = value;
      }
    }
    if (thinking.default === true || typeof thinking.default === "string") {
      onByDefault = true;
    }
  }

  const reasoning = Object.keys(levels).length > 0 ? { control: "think" as const, levels, onByDefault } : { control: "none" as const, levels: {}, onByDefault: false };
  return { id: "ollama-measured", reasoning, temperature: "supported", outputCapField: "max_tokens" };
}
