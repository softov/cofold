import type { ModelPricing, Usage } from '../types/model.js';

/**
 * One formula across providers (decision 109): `inputTokens` counts every prompt token, so the cached ones are
 * taken out of it and priced at their own rates, which default to the input rate. Rounded to micro-dollars so
 * JSONL and equality tests are stable.
 */
export function costOf(usage: Usage, pricing: ModelPricing): number {
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  const plain = Math.max(0, usage.inputTokens - read - write);
  const micro =
    plain * pricing.inputPerMillion +
    read * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion) +
    write * (pricing.cacheWritePerMillion ?? pricing.inputPerMillion) +
    usage.outputTokens * pricing.outputPerMillion;
  return Math.round(micro) / 1e6;
}
