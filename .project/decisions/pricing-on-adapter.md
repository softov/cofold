---
title: 108 - Pricing lives on the adapter, with cache rates; absent pricing means unknown cost
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/provider.ts#L60-L71 - `ModelInfo.pricing`, the catalogue's shape that becomes `ModelPricing`
  - code://packages/agents/src/types/model.ts#L23-L30 - `Usage`, which gains `cacheWriteTokens?`
  - code://packages/model-openai-compat/src/wire.ts#L117-L141 - `fromWireModel` reads OpenRouter's `pricing.prompt` / `completion`
---

## Context

OpenRouter's catalogue reports prices; LM Studio reports none; Anthropic bills cache reads and writes at their own rates. `provider.model()` is synchronous, so it cannot look prices up.

## Decision

`ModelPricing { inputPerMillion, outputPerMillion, cacheReadPerMillion?, cacheWritePerMillion?, currency: 'USD' }` (named, shared with `ModelInfo.pricing`); `ModelAdapter.pricing?` is set by `provider.model({ id, pricing? })` / `openaiCompat({ pricing })`, the catalogue's value passed through by the host.
`Usage` gains `cacheWriteTokens?`. No pricing means no cost is recorded and `maxCost` never trips.

Source: user, 2026-09-16, asked "Adapter, from the catalogue, with cache rates / Adapter, input-output only / Agent options".

## Consequences

`fromWireModel` maps OpenRouter's cache prices when present (field names verified at build). A missing price never looks free: `cost` is absent, not zero.
