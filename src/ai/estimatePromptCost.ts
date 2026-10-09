// Offline prompt-cost estimation backing the settings webview's "Estimate
// Cost" button. Pure and vscode-free: token counting runs locally via
// gpt-tokenizer (OpenAI's o200k_base tokenizer) and the pricing table below
// is a fixed benchmark set, deliberately independent of the provider the
// user selected, so the result is a stable cost comparison across providers.

import { countTokens } from "gpt-tokenizer";
import type { CommitStyle } from "../commitMessage";

// The date the benchmark pricing table below was last verified against the
// providers' official pricing pages. A single parseable constant so the
// staleness test (test/estimatePromptCost.test.ts) and any future tooling
// can check freshness without parsing prose out of UI strings.
export const PRICING_RETRIEVED_AT = "2026-10-08";

// Fixed reference values for how large a generated commit message typically
// is per style. Commit messages are tiny next to the prompt; these are the
// "estimated output" column of the result, not measurements.
export const ESTIMATED_OUTPUT_TOKENS: Readonly<Record<CommitStyle, number>> = {
  lengthy: 250,
  medium: 200,
  short: 150,
  titleOnly: 80,
};

// One row of the fixed benchmark table. Prices are per 1M tokens, USD.
export interface BenchmarkPrice {
  modelId: string;
  providerLabel: string;
  inputPricePerM: number;
  outputPricePerM: number;
  sourceUrl: string;
}

export const BENCHMARK_PRICES: readonly BenchmarkPrice[] = [
  { modelId: "gpt-4o-mini", providerLabel: "OpenAI", inputPricePerM: 0.15, outputPricePerM: 0.6, sourceUrl: "https://developers.openai.com/api/docs/pricing" },
  { modelId: "gpt-4.1-mini", providerLabel: "OpenAI", inputPricePerM: 0.4, outputPricePerM: 1.6, sourceUrl: "https://developers.openai.com/api/docs/pricing" },
  { modelId: "deepseek-flash", providerLabel: "DeepSeek", inputPricePerM: 0.15, outputPricePerM: 0.6, sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/" },
  { modelId: "deepseek-v4-pro", providerLabel: "DeepSeek", inputPricePerM: 0.66, outputPricePerM: 1.98, sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/" },
  { modelId: "gemini-2.5-flash", providerLabel: "Google Gemini", inputPricePerM: 0.3, outputPricePerM: 2.5, sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing" },
  { modelId: "gemini-2.5-flash-lite", providerLabel: "Google Gemini", inputPricePerM: 0.1, outputPricePerM: 0.4, sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing" },
];

// One measured style row of the result payload.
export interface CostEstimateStyleRow {
  style: CommitStyle;
  systemTokens: number;
  userTokens: number;
  estOutputTokens: number;
}

// One benchmark model row with the computed cost for every measured style.
export interface CostEstimateModelRow {
  modelId: string;
  providerLabel: string;
  perStyleCost: Record<CommitStyle, number>;
}

// The payload the settings panel posts to the webview for the cost table.
export interface CostEstimateResult {
  repoPath: string;
  styles: CostEstimateStyleRow[];
  models: CostEstimateModelRow[];
  retrievedAt: string;
}

// Counts tokens with OpenAI's o200k_base tokenizer. Exact for OpenAI models;
// approximate for other providers, whose tokenizers are closed (see the
// result footer disclaimer).
export function countPromptTokens(text: string): number {
  return countTokens(text);
}

// Computes the USD cost of one request from token counts and a price entry.
export function estimateCost(inputTokens: number, outputTokens: number, price: Pick<BenchmarkPrice, "inputPricePerM" | "outputPricePerM">): number {
  return (inputTokens / 1_000_000) * price.inputPricePerM + (outputTokens / 1_000_000) * price.outputPricePerM;
}

// Builds the per-model cost rows for a set of measured styles.
export function buildModelCostRows(styles: readonly CostEstimateStyleRow[]): CostEstimateModelRow[] {
  return BENCHMARK_PRICES.map((price) => {
    const perStyleCost = {} as Record<CommitStyle, number>;
    for (const row of styles) {
      perStyleCost[row.style] = estimateCost(row.systemTokens + row.userTokens, row.estOutputTokens, price);
    }
    return { modelId: price.modelId, providerLabel: price.providerLabel, perStyleCost };
  });
}
