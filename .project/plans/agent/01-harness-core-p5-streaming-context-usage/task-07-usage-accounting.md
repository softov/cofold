---
title: Usage accounting
status: done
depends: [task-05-streaming.md]
layer: agents
refs:
  - code://packages/agents/src/types/model.ts#L23-L30 - `Usage { inputTokens, outputTokens, cacheReadTokens?, reasoningTokens? }`; gains `cacheWriteTokens?`
  - code://packages/agents/src/types/provider.ts#L60-L71 - `ModelInfo.pricing { inputPerMillion, outputPerMillion, currency }` is the catalogue's shape; it becomes the shared `ModelPricing`
  - code://packages/agents/src/model/usage.ts - `ZERO_USAGE`, `addUsage`; `cost.ts` sits next to it
  - code://packages/agents/src/types/limits.ts - `Limits`; gains `maxCost`
  - code://packages/agents/src/run/turn.ts#L154-L157 - the loop-top limit checks (`abort`, steer drain, `maxSteps`); `maxCost` is checked there
  - code://packages/agents/src/run/turn.ts#L211-L212 - `counters.usage = addUsage(...)` after every reply; cost is accumulated in the same place
  - code://packages/agents/src/run/turn.ts#L128-L137 - `finishRun` writes `usage` and `steps` to the run record; `cost` goes with them
  - code://packages/agents/src/run/resume.ts#L207-L222 - `countersOf`: a paused run's counters come from the record, a dead run's from the step log; cost follows the same rule
  - code://packages/agents/src/types/store.ts#L38,L147 - `RunRecord.usage` and `runs.update({ usage })`; `cost` is added to both
  - code://packages/agents/src/store/memory.ts#L119-L130 - `update` copies `usage`; the file store's `update` (`store-file/src/store.ts:160-171`) does the same
  - code://packages/agents/src/testing/store-conformance.ts#L176-L190 - the conformance cases for `update`; `cost` is added there so every store proves it
  - code://packages/model-openai-compat/src/wire.ts#L117-L141 - `fromWireModel` reads OpenRouter's `pricing.prompt` / `pricing.completion`; the cache rates come from the same object
---

## Objective

Every run records what it cost.
Pricing lives on the adapter, taken from the provider's catalogue or given by the host; a run stops at `limits.maxCost` with `stopped { reason: 'max_cost' }`.

## Files

- `UPDATE: packages/agents/src/types/model.ts:23-30,55-63` - `Usage.cacheWriteTokens?`, `ModelPricing`, `ModelAdapter.pricing?`.
- `UPDATE: packages/agents/src/types/provider.ts:60-82` - `ModelInfo.pricing?: ModelPricing`; `model(args)` gains `pricing?`.
- `UPDATE: packages/agents/src/types/limits.ts` and `packages/agents/src/agent/limits.ts` - `maxCost`, default `0`.
- `UPDATE: packages/agents/src/types/outcome.ts` - `StopReason` gains `'max_cost'`; every `RunOutcome` variant gains `cost?: number`.
- `UPDATE: packages/agents/src/types/store.ts:38,147` - `RunRecord.cost?`, `update({ cost? })`.
- `UPDATE: packages/agents/src/types/turn.ts` - `TurnContext.counters.cost: number | undefined`.
- `CREATE: packages/agents/src/model/cost.ts` - `costOf`.
- `UPDATE: packages/agents/src/model/usage.ts` - `addUsage` carries `cacheWriteTokens`.
- `UPDATE: packages/agents/src/run/turn.ts:154-157,211-212,128-137` and every outcome literal - the check, the accumulation, the record.
- `UPDATE: packages/agents/src/run/resume.ts:207-222` - `countersOf` computes `cost`.
- `UPDATE: packages/agents/src/run/run.ts:85` - `counters` gain `cost`.
- `UPDATE: packages/agents/src/store/memory.ts:119-130`, `packages/store-file/src/store.ts:160-171` - persist `cost`.
- `UPDATE: packages/agents/src/testing/store-conformance.ts:176-190` - `cost` round-trips through `update`.
- `UPDATE: packages/agents/src/testing/fake-model.ts` - `createFakeModel({ pricing? })`.
- `CREATE: packages/agents/src/run/cost.test.ts`.
- `UPDATE: packages/model-openai-compat/src/index.ts`, `src/wire.ts:117-141`, `src/types/wire.ts`, `src/types/options.ts` - `pricing` on `model()` and `openaiCompat()`, cache rates from the catalogue.
- `UPDATE: packages/agents/README.md`, `packages/model-openai-compat/README.md`.

## Steps

1. Contracts (decisions 108, 109; `maxCost` per the harness spec). In `types/model.ts`:

   ```ts
   export interface Usage {
     /** Every prompt token, cached ones included (decision 109). */
     inputTokens: number;
     outputTokens: number;
     cacheReadTokens?: number;
     /** Provider-reported cache writes, when known (Anthropic `cache_creation_input_tokens`). */
     cacheWriteTokens?: number;
     reasoningTokens?: number;
   }

   /** USD per million tokens (decision 108). Cache rates default to the input rate. */
   export interface ModelPricing {
     inputPerMillion: number;
     outputPerMillion: number;
     cacheReadPerMillion?: number;
     cacheWritePerMillion?: number;
     currency: 'USD';
   }
   ```

   `ModelAdapter` gains `/** Absent means unknown: no cost is recorded and maxCost never trips (decision 108). */ pricing?: ModelPricing;`.
   `types/provider.ts`: `ModelInfo.pricing?: ModelPricing` and `model(args: { id: string; features?: Partial<ModelFeatures>; params?: ModelParams; pricing?: ModelPricing }): ModelAdapter`.
   `types/limits.ts`: `/** USD per run; 0 = no limit (harness spec: cost limits enforced by the runtime). */ maxCost: number;` with `DEFAULT_LIMITS.maxCost: 0`.
   `types/outcome.ts`: `StopReason` gains `'max_cost'`; each `RunOutcome` variant gains `cost?: number` after `usage`.
   `types/store.ts`: `RunRecord.cost?: number` after `usage`; `update(args: ... & { cost?: number })`.

2. `model/cost.ts` (decision 109):

   ```ts
   /** Rounded to micro-dollars so JSONL and equality tests are stable. */
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
   ```

   `addUsage` carries `cacheWriteTokens` the way it carries `cacheReadTokens`.

3. The loop. `TurnContext.counters` gains `cost: number | undefined` (`undefined` when the adapter has no pricing; `run.ts` initialises it to `agent.model.pricing ? 0 : undefined`). After `counters.usage = addUsage(counters.usage, reply.usage)` in `turn.ts` and in `compact.ts`'s `writeSummary`: `if (agent.model.pricing) counters.cost = (counters.cost ?? 0) + costOf(reply.usage, agent.model.pricing);`. At the loop top, after the `maxSteps` check: `if (agent.limits.maxCost > 0 && counters.cost !== undefined && counters.cost >= agent.limits.maxCost) return await finishRun(ctx, { status: 'stopped', reason: 'max_cost', ...tally(ctx) });`. Every outcome literal in `turn.ts`, `run.ts`, `resume.ts` and `fail()` / `abortOutcome()` goes through one helper `tally(ctx): { usage, steps, cost? }` so `cost` is never forgotten; `finishRun` and `pause` pass `cost` to `store.runs.update`. `countersOf` in `resume.ts`: `cost` is `record.cost` for a paused run and recomputed from the step log's replies for a dead one (same rule as usage).

4. Stores. `memory.ts` `update` copies `cost` when given; `store-file` `update` writes it into `run.json`. Conformance: the `update` case sets `cost: 0.0123` and reads it back; a record created without `cost` reads back without it.

5. openai-compat. `openaiCompat({ pricing? })` and `provider.model({ id, pricing? })` set `adapter.pricing`; nothing is looked up at `model()` time (it is synchronous; the host passes `listModels()[i].pricing` through). `fromWireModel` maps OpenRouter's `pricing.input_cache_read` and `pricing.input_cache_write` (USD per token, decimal strings, next to `prompt` / `completion`; verify the field names against `GET https://openrouter.ai/api/v1/models` at build time) to `cacheReadPerMillion` / `cacheWritePerMillion` when finite. `fake-model.ts`: `createFakeModel({ pricing })` sets `adapter.pricing`.

6. `run/cost.test.ts`:
   1. `costOf`: plain input/output; cache read at its own rate; cache read and write falling back to the input rate; rounding.
   2. A two-step run with `pricing: { inputPerMillion: 1, outputPerMillion: 2 }` and the fake's `usage0` (1/1 per step) ends `completed` with `cost: 0.000006`, `RunRecord.cost` equal, `run.finished.outcome.cost` equal.
   3. No pricing: `cost` absent from the outcome and the record; `maxCost: 0.000001` never trips.
   4. `limits: { maxCost: 0.000004 }` on a three-step script: the second step completes (it crosses the limit), the third never starts, outcome `stopped { reason: 'max_cost' }`, `steps: 2`.
   5. `resume()` of a paused run carries `cost` on; `resume()` of a dead run recomputes it from the step log.
   6. `compact()` adds the summary step's cost.

## Validation

- `pnpm check` (conformance runs against the memory and file stores).
- `examples/agents/lmstudio-tools.ts` prints `cost` when `FACIO_PRICING_IN` / `FACIO_PRICING_OUT` are set (manual).

## Resume

Built 2026-09-16.

- Contracts: `types/model.ts` `Usage.cacheWriteTokens?`, `ModelPricing`, `ModelAdapter.pricing?` (decision 108); `types/provider.ts` `ModelInfo.pricing?: ModelPricing`, `model({ id, features?, params?, pricing? })`; `types/limits.ts` `maxCost` with `DEFAULT_LIMITS.maxCost: 0`; `types/outcome.ts` `StopReason` `'max_cost'` and `RunTally { usage, steps, cost? }`, which every `RunOutcome` variant intersects; `types/store.ts` `RunRecord.cost?`, `runs.update({ cost? })`; `types/turn.ts` `counters.cost: number | undefined`.
- `model/cost.ts` `costOf(usage, pricing)` per decision 109 (cache reads and writes taken out of `inputTokens`, priced at their rates or the input rate, micro-dollar rounding); `addUsage` carries `cacheWriteTokens`; `costOf` exported from the package entry.
- Loop: `run/turn.ts` `tally(ctx): RunTally` (exported) is what every outcome literal, `fail()`, `abortOutcome()`, `finishRun`'s and `pause`'s `runs.update` spread; cost accumulates after `addUsage` in `turn.ts` and `compact.ts`'s `writeSummary`; the `maxCost` check sits after the `maxSteps` check at the loop top. `run/run.ts` initialises `counters.cost` to `0` with pricing and `undefined` without (and the setup-failure outcome carries `cost: 0` when pricing is known). `run/resume.ts` `countersOf(record, steps, pricing)` carries a paused run's `record.cost` on and recomputes a dead run's from the step log's replies.
- Stores: `store/memory.ts` and `store-file/src/store.ts` `update` write `cost` when given; the conformance suite gained "persists cost only when it is given" (absent stays absent, `0.0123` round-trips, a record created with `cost` reads back equal); it ran against both stores.
- openai-compat: `openaiCompat({ pricing })` and `provider.model({ id, pricing })` set `adapter.pricing`; `fromWireModel` maps `input_cache_read` / `input_cache_write` (field names verified against the live `GET https://openrouter.ai/api/v1/models` on 2026-09-16, USD per token as decimal strings) to `cacheReadPerMillion` / `cacheWritePerMillion` when finite; `WireModel.pricing` and `OpenAICompatOptions.pricing` typed.
- Fake model: `createFakeModel({ pricing })`.
- Tests: `run/cost.test.ts` (11: `costOf` x4, `DEFAULT_LIMITS.maxCost`, two-step sum on outcome / event / record, no pricing means no cost and `maxCost` never trips, `maxCost` stop after the crossing step with the next never started, paused run carries cost through `resume()`, dead run recomputed from the step log, `compact()` cost); `contracts.test-d.ts` gained the tally / pricing / `max_cost` case; `index.test.ts` gained the catalogue cache rates and the `pricing` pass-through case; the conformance case above.
- READMEs: `@doopx/agents` (outcome `cost`, `maxCost`, pricing on the adapter, `costOf` in the layout), `@doopx/model-openai-compat` (`listModels()` cache rates, `pricing` option), `examples/agents/README.md` (`FACIO_PRICING_IN` / `FACIO_PRICING_OUT`); `examples/agents/lmstudio-tools.ts` passes them as `pricing` and prints `usage` and `cost`.

Evidence: `@doopx/agents` build and typecheck green; `vitest --project @doopx/agents` 18 files, 178 tests; `@doopx/model-openai-compat` 4 files, 67 tests; `@doopx/store-file` (28 in `store.test.ts`), `@doopx/tools`, `@doopx/papo` tests green against the new build (15 files, 144 tests); examples typecheck green. Not run against a live server (manual).

Deviations and findings:
- `RunTally` is a named interface in `types/outcome.ts` that every outcome variant intersects, instead of `cost?: number` repeated in five literals: one definition, and agent/04 task 02 extends it in one place.
- `countersOf` takes the adapter's pricing as a parameter (it is a module-level function without access to the agent).
- `run.ts`'s setup-failure outcome carries `cost: 0` when the adapter has pricing (nothing was spent and the price is known); the plan did not mention that literal.
- `packages/papo` typecheck fails on `Snapshot.queued` (`src/claude/chat.ts`, `src/turns.test.ts`); that is cli/04 task 01 in progress in another session, not this contract. papo's tests pass.
