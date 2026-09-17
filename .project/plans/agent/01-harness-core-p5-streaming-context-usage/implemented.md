---
title: AGENT-01-p5 - Steering, hook stop, thinking levels, streaming, context reduction, usage accounting - implemented
date: 2026-09-16
refs:
  - git://1705e4ff6d3f2bd0bdf9ffa886560537d1d637d8 - the last commit before this plan's work; everything below is uncommitted on top of it
  - code://packages/agents/src/run/turn.ts - the loop: steering drain, hook stop, `callModel`, `tally`, `interrupt`, the `maxCost` check
  - code://packages/agents/src/run/compact.ts - the summary step, the tail, `context.compacted`
  - code://packages/agents/src/run/resume.ts - `countersOf` with cost, cancel-while-waiting denies
  - code://packages/agents/src/model/cost.ts - `costOf`
  - code://packages/agents/src/message/markers.ts - `INTERRUPTED`, `INTERRUPTED_TOOL`
  - code://packages/model-openai-compat/src/sse.ts - the SSE parser
  - code://packages/model-openai-compat/src/stream.ts - chunks to `ModelStreamEvent`s
---

A running turn can be steered without cancelling it, a hook can end a run on purpose, reasoning effort covers every level providers accept, an adapter can refresh its credentials and key a provider-side prompt cache.
Long answers stream as persisted `model.delta` events, a compaction keeps a verbatim tail and reports before and after tokens, every run records its cost and stops at a dollar ceiling, a caller can name its input message, and a cancel leaves the transcript model-valid: the cut calls answered, an interrupt marker written, and an open request denied.

## What was built

- `code://packages/agents/src/run/steering.ts`, `run/handle.ts`, `run/run.ts`, `run/resume.ts` - steer queue, `submit({ type: 'steer' })`, `run.steered`, `not_running` (decisions 95, 96, 101; tasks 01-02).
- `code://packages/agents/src/run/tools.ts`, `run/turn.ts` - `beforeTool` / `afterTool` stop, `stopped { reason: 'hook' }` (decision 97; task 03).
- `code://packages/model-openai-compat/src/index.ts`, `wire.ts`, `types/options.ts` - effort levels, `reasoningBudgets`, an `apiKey` function per attempt, `prompt_cache_key` (decisions 98-100; task 04).
- `code://packages/agents/src/types/model.ts` - `ModelStreamEvent`, `ModelAdapter.stream?`, `ModelAdapter.pricing?`, `ModelPricing`, `Usage.cacheWriteTokens?` (decisions 105, 108).
- `code://packages/agents/src/run/turn.ts` - `callModel` streams when the adapter can and emits one persisted `model.delta { step, kind, text }` per fragment, `toolCall.delta` ignored, a stream without `done` fails the step (decisions 102, 104, 105; task 05); `tally(ctx)` on every outcome and run update, `maxCost` checked before a step (decision 109; task 07); `interrupt()` on every abort exit (cli/03 F4; task 08).
- `code://packages/agents/src/testing/fake-model.ts` - `createFakeModel({ stream: true, pricing })`.
- `code://packages/model-openai-compat/src/sse.ts`, `stream.ts`, `types/sse.ts`, `types/wire.ts` - own SSE parser, `parseChunks`, `streamChunks` with the `<think>` splitter and tool-call assembly by index, `WireChunk`; `stream()` on the adapter, `DEFAULT_FEATURES.streaming: true`, `attempt()` shared by `send()` and `sendStream()` (task 05).
- `code://packages/agents/src/model/cost.ts`, `model/usage.ts`, `types/outcome.ts`, `types/store.ts`, `types/limits.ts`, `agent/limits.ts`, `store/memory.ts`, `code://packages/store-file/src/store.ts`, `testing/store-conformance.ts` - `costOf`, `RunTally`, `RunRecord.cost`, `runs.update({ cost })`, `maxCost` default 0, `StopReason 'max_cost'`, both stores persist `cost`, the conformance case (decisions 108, 109; task 07).
- `code://packages/model-openai-compat/src/wire.ts` - catalogue cache rates (`input_cache_read`, `input_cache_write`) into `ModelPricing`; `openaiCompat({ pricing })` and `model({ id, pricing })` (task 07).
- `code://packages/agents/src/run/compact.ts`, `run/context.ts`, `types/agent.ts`, `agent/create-agent.ts`, `types/event.ts` - compaction (task 06); the retained tail (`compactKeepTokens`, default 20% of `maxTokens`), `contextOf` exported, `context.compacted { summarized, kept, estimatedTokens, afterTokens }` (cli/03 F1, F7; task 08).
- `code://packages/agents/src/types/run.ts`, `run/run.ts` - `RunArgs.messageId?`, `CompactArgs.messageId?`, a duplicate fails `already_exists` with nothing written (cli/03 F2; task 08).
- `code://packages/agents/src/message/markers.ts` - `INTERRUPTED`, `INTERRUPTED_TOOL` (cli/03 F4; task 08).
- `code://packages/agents/src/run/resume.ts` - a cancel on an awaiting run denies its request `The turn was stopped` and finishes `cancelled` with the marker (decision 120, cli/03 F6; task 08).
- `code://examples/agents/steer.ts`, `adapter-smoke.ts`, `lmstudio-tools.ts` - steering, `--effort`, streamed output and `cost` from `FACIO_PRICING_IN` / `FACIO_PRICING_OUT`.

## Verified

- `@facio/agents`: 19 test files, 193 tests (`run/steering.test.ts`, `hook-stop.test.ts`, `stream.test.ts` 8, `cost.test.ts` 11, `compact.test.ts` 10, `interrupt.test.ts` 5, `run.test.ts` 26, `resume.test.ts` 16, `contracts.test-d.ts` 17, the rest unchanged); build and typecheck green.
- `@facio/model-openai-compat`: 4 test files, 67 tests (`sse.test.ts` 8, `stream.test.ts` 13, `index.test.ts` 43, `wire.test.ts` 3); typecheck green.
- `@facio/store-file` (32 tests, the conformance suite with the `cost` case), `@facio/tools` (24), `@facio/papo` (8 files) green against the new build; every package and the examples typecheck green except `@facio/papo`, whose `Snapshot.queued` errors are cli/04 task 01 in progress in another session.
- Full `pnpm check` run at the close of task 08: see the report of 2026-09-16; not run against a live LM Studio or OpenRouter (the `lmstudio-tools` and `adapter-smoke` examples are the manual checks).
- OpenRouter's catalogue field names for the cache rates were verified against the live `GET /models` on 2026-09-16.

## Departures from the plan

- `SseEvent` lives in `packages/model-openai-compat/src/types/sse.ts`, and `INTERRUPTED` / `INTERRUPTED_TOOL` in `packages/agents/src/message/markers.ts`, not in the files the tasks named: a types file never exports a const, and an exported type lives in `src/types/`.
- `RunTally` is a named interface every `RunOutcome` variant intersects, instead of `cost?` repeated per variant; `tally()` returns it and agent/04 task 02 extends it in one place.
- `interrupt()` returns the abort outcome; the marker is written on every abort exit, the two the task's step list did not name included (the model-call and `writeSummary` abort catches), as the task's Files section and Claude's runtime say.
- A `compact()` run's ask is kept out of the tail and covered by the summary, otherwise the tail rule would have left "Summarize the conversation so far." verbatim after the summary.
- `processCalls` applies a persisted decision before its abort check, so the cancel's own deny reaches the transcript (decision 120).
- `parseSse` cancels the body when the consumer stops early; the plan said "released".
- `mapFinish` accepts `null`; `usageOf` and `mapFinish` are exported from `wire.ts` so both forms share them.
- `countersOf` takes the adapter's pricing as a parameter; the setup-failure outcome in `run.ts` carries `cost: 0` when pricing is known.
- `packages/papo/src/chat.test.ts:312` changed one expected message order to include the tail; papo's adoption of the new contracts stays with cli/04.

## Left for later

- papo reads `model.delta`, `contextOf`, the marker, `cost` and the stop reasons: [cli/04-papo-harness-adoption](../../cli/04-papo-harness-adoption/plan.md).
- `tally()` gains `denials`: [agent/04-policy-rules](../04-policy-rules/plan.md) task 02.
- An unterminated inline `<think>` stays reasoning in the streamed form where the whole-response form kept it as text; and when every unit fits in `compactKeepTokens` the summary stands for the ask alone: both noted in the task Resumes, neither decided.
- `@facio/chat` decision 12 (queue) and papo's `turns.ts` mapping of every `stopped` outcome to `cancelled` (the plan's *Watch out for*): the cli plans.
