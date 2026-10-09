// Unit tests for the Estimate Cost feature's pricing/token math
// (src/ai/estimatePromptCost.ts). Besides the pure functions, this file acts
// as a watchdog for the pricing data: it fails when the retrieval date gets
// stale, reminding us to re-check the providers' official pricing pages.
// Runs via mocha + ts-node (see .mocharc.json).

import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { BENCHMARK_PRICES, buildModelCostRows, countPromptTokens, estimateCost, PRICING_RETRIEVED_AT } from "../src/ai/estimatePromptCost";

// How long the pricing table may stay unverified before the watchdog test
// fails and forces a re-check of the official pricing pages.
const MAX_PRICE_AGE_DAYS = 90;

describe("estimatePromptCost pricing data", () => {
  it("stores PRICING_RETRIEVED_AT as a parseable ISO date that is not in the future", () => {
    assert.match(PRICING_RETRIEVED_AT, /^\d{4}-\d{2}-\d{2}$/);
    const parsed = Date.parse(`${PRICING_RETRIEVED_AT}T00:00:00Z`);
    assert.ok(!Number.isNaN(parsed), `PRICING_RETRIEVED_AT is not a parseable date: ${PRICING_RETRIEVED_AT}`);
    assert.ok(parsed <= Date.now(), `PRICING_RETRIEVED_AT must not be in the future: ${PRICING_RETRIEVED_AT}`);
  });

  it("fails as a reminder when the pricing data has not been verified recently", () => {
    const retrieved = Date.parse(`${PRICING_RETRIEVED_AT}T00:00:00Z`);
    const ageDays = (Date.now() - retrieved) / (24 * 60 * 60 * 1000);
    const sources = [...new Set(BENCHMARK_PRICES.map((price) => price.sourceUrl))];
    assert.ok(
      ageDays <= MAX_PRICE_AGE_DAYS,
      `Pricing data was last verified ${PRICING_RETRIEVED_AT} (${Math.floor(ageDays)} days ago).\n` +
        `Re-check the official pricing pages:\n${sources.join("\n")}\n` +
        `then update PRICING_RETRIEVED_AT and BENCHMARK_PRICES in src/ai/estimatePromptCost.ts.`,
    );
  });

  it("keeps a sane benchmark table: positive prices, non-empty ids and sources, no duplicates", () => {
    const seen = new Set<string>();
    for (const price of BENCHMARK_PRICES) {
      assert.ok(price.modelId.trim(), "modelId must not be empty");
      assert.ok(price.providerLabel.trim(), "providerLabel must not be empty");
      assert.ok(price.sourceUrl.trim(), "sourceUrl must not be empty");
      assert.ok(price.inputPricePerM > 0, `${price.modelId}: inputPricePerM must be positive`);
      assert.ok(price.outputPricePerM > 0, `${price.modelId}: outputPricePerM must be positive`);
      assert.ok(!seen.has(price.modelId), `duplicate benchmark model: ${price.modelId}`);
      seen.add(price.modelId);
    }
  });
});

describe("estimatePromptCost math", () => {
  it("counts tokens with the o200k tokenizer", () => {
    // Known o200k_base count for this exact string.
    assert.equal(countPromptTokens("Hello world"), 2);
    assert.equal(countPromptTokens(""), 0);
  });

  it("computes the request cost from input and output token counts", () => {
    const price = { inputPricePerM: 0.15, outputPricePerM: 0.6 };
    assert.equal(estimateCost(1_000_000, 0, price), 0.15);
    assert.equal(estimateCost(0, 1_000_000, price), 0.6);
    assert.equal(estimateCost(500_000, 500_000, price), 0.075 + 0.3);
  });

  it("builds one cost row per benchmark model, keyed by style", () => {
    const rows = buildModelCostRows([
      { style: "lengthy", systemTokens: 2_000, userTokens: 10_000, estOutputTokens: 250 },
      { style: "titleOnly", systemTokens: 1_500, userTokens: 4_000, estOutputTokens: 80 },
    ]);

    assert.equal(rows.length, BENCHMARK_PRICES.length);
    const gpt4oMini = rows.find((row) => row.modelId === "gpt-4o-mini");
    assert.ok(gpt4oMini);
    // 12,000 input tokens at $0.15/1M + 250 output at $0.60/1M.
    assert.ok(Math.abs(gpt4oMini.perStyleCost.lengthy - (0.0018 + 0.00015)) < 1e-9);
    // 5,500 input tokens at $0.15/1M + 80 output at $0.60/1M.
    assert.ok(Math.abs(gpt4oMini.perStyleCost.titleOnly - (0.000825 + 0.000048)) < 1e-9);
  });
});
