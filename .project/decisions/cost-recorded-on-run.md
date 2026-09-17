---
title: 109 - Cost is recorded on the run and every outcome; one formula across providers
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/store.ts#L38 - `RunRecord.usage`, where `cost?` goes
  - code://packages/agents/src/run/turn.ts#L128-L137 - `finishRun` writes usage and steps; cost goes with them
  - code://packages/agents/src/run/resume.ts#L207-L222 - `countersOf`: paused from the record, dead from the step log
  - code://packages/papo/src/claude/chat.ts#L395-L398 - papo's Claude backend already sums input, cache read and cache creation into `inputTokens`
---

## Context

Prices change; a cost computed at read time would drift from what was paid.
Providers report cached tokens differently: Chat Completions counts them inside `prompt_tokens`, Anthropic reports them apart from `input_tokens`.

## Decision

`RunRecord.cost?` (USD) next to `usage`, and `cost?` next to `usage` on every `RunOutcome` variant, written with the counters at every run update.
`resume()` carries a paused run's cost on and recomputes a dead run's from the step log.
`Usage.inputTokens` counts every prompt token, cached ones included; an adapter that reports them apart adds them up.
`costOf(usage, pricing)` = plain input × input rate + cache reads × (cache read rate ?? input rate) + cache writes × (cache write rate ?? input rate) + output × output rate, per million, rounded to micro-dollars.

Source: user, 2026-09-16, asked "Recorded / Computed"; `(defaulted: the formula and the inputTokens convention, needed for one costOf across providers)`.

## Consequences

One `costOf` in `model/cost.ts`; `tally(ctx)` puts `{ usage, steps, cost? }` on every outcome so none forgets it.
Stores persist `cost`; the conformance suite proves it.

## Options

Computing at read time needed the pricing at read time and drifted from what was billed.
