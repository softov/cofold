---
title: AGENT-01-p5 - Steering, hook stop, thinking levels, streaming, context reduction, usage accounting
domain: agent
status: active
priority: medium
created: 2026-09-13
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core/plan.md
---

# AGENT-01-p5 - Steering, hook stop, thinking levels, streaming, context reduction, usage accounting

Child of [01-harness-core.md](../01-harness-core/plan.md).
Spec build step 5: "Add streaming, context reduction, usage accounting, and more model adapters as separate increments. Test partial streamed calls and recovery after an uncertain tool invocation."

Tasks 1-4 are built (2026-09-16); they close the gaps found when comparing the harness against a second agent loop's option surface (steering, a hook that ends the run, thinking levels, dynamic API keys, a provider cache key).
Tasks 5 and 7 are the spec's increments (streaming, usage accounting), planned in full on 2026-09-16.
Task 8 is the harness side of the papo contra-validation (`cli/03` findings F1, F2, F4): Claude is the reference the harness is checked against through papo, never a model the harness calls (user, 2026-09-16); the earlier "second adapter" outline (an Anthropic Messages API adapter) is void.

## Goal

A running turn can be redirected by the person without cancelling it; a hook or a tool can end a run cleanly; reasoning effort covers the whole range providers accept; an adapter can refresh its credentials; then long answers stream, long sessions stay inside the budget without losing the transcript, and usage is accounted per run.

## Reconnaissance

### Files read

- `packages/agents/src/types/command.ts` - `RunCommand` is `approve | deny | answer | cancel`; nothing reaches a running turn except cancel.
- `packages/agents/src/types/hooks.ts` - `BeforeToolResult` is `allow | modify | deny | approval`; `AfterToolResult` is `{ output, isError? }`. Neither can end the run; only `beforeModel` / `afterModel` can, through `{ abort }` (decision 58 → `stopped { reason: 'policy' }`).
- `packages/agents/src/types/model.ts` - `ModelParams.reasoning.effort` is `'low' | 'medium' | 'high'`; `ModelRequest` carries no session identity, so an adapter cannot key a provider-side prompt cache.
- `packages/agents/src/types/outcome.ts` - `StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy'`.
- `packages/agents/src/types/event.ts` - `run.started { input }` is the only event that carries a user message; `model.delta` exists for Task 5.
- `packages/agents/src/errors.ts` - `AgentErrorCode` list; no code for "the run is no longer running".
- `packages/agents/src/run/turn.ts` - `runTurn` (`for (;;)` at line 168: abort check, `maxSteps`, `listMessages`, `assembleRequest`, hooks, `complete`, `processCalls`); `processCalls` (line 253, serial batch, decisions 54-56); `finishRun` / `settle`.
- `packages/agents/src/run/tools.ts` - `handleToolCall` (validate → `beforeTool` → policy → remembered approval → `execute`); `ToolCallResult` union (`result | approval | input | aborted`); `afterTool` applied at line 109 before the step record and `tool.completed`.
- `packages/agents/src/run/handle.ts` - `createRunHandle({ runId, sessionId, abort, onCommand? })`; `submit` routes `cancel` to the abort and everything else to `onCommand`, which only `resume()` installs (decision 86).
- `packages/agents/src/run/run.ts:21-32`, `packages/agents/src/run/resume.ts:30-47` - the two places a handle is created; `resume` gates commands behind `ready` / `accept`; `validateCommand` (line 213) rejects a command that does not answer the pending request.
- `packages/model-openai-compat/src/index.ts` - `OpenAICompatProviderOptions.apiKey?: string` baked into `headers` once (line 43); `send` retries per decision 32.
- `packages/model-openai-compat/src/wire.ts:66-71` - `toWireReasoning`: `maxTokens` → OpenRouter `reasoning: { effort?, max_tokens }`, else `reasoning_effort`.
- papo (`cli` domain, not yet planned): a message sent while a run is attached steers it; a follow-up queue, if any, is the program's.

### Searches performed

- `grep -rn "onCommand" packages/agents/src/run` - installed only by `resume.ts`; `run.ts` creates the handle without it.
- `grep -rn "'policy'" packages/agents/src` - decision 58's mapping is in `turn.ts` only (`beforeModel` / `afterModel` abort); no tool-side stop exists.
- `grep -rn "reasoning_effort\|prompt_cache_key" packages/model-openai-compat/src` - `reasoning_effort` sent as-is; `prompt_cache_key` never sent.

### Runtime path (Tasks 1-4)

```
handle.submit({ type: 'steer', text })
  → handle.steer(text) → steering.push({ text, resolve, reject })      (both run() and resume() handles)
  → runTurn loop top, before listMessages: drainSteering(ctx)
      appendMessages([{ role: 'user', source: 'input', parts: [{ type: 'text', text }] }])
      emit run.steered { message } ; resolve()
  → assembleRequest sees the message after the last tool result
settle(ctx) → reject undrained steers with AgentError { code: 'not_running' }

beforeTool → { decision: 'stop', reason } → tool result "Not executed: <reason>" appended, rest of batch answered "Not executed: the run was stopped", finishRun stopped { reason: 'hook' }
afterTool  → { output, stop: { reason } }  → result appended as usual, rest of batch answered, finishRun stopped { reason: 'hook' }
```

### Existing patterns to reuse

- Decision 90 (answer every unanswered call of the batch so the transcript stays model-valid) is the pattern for the calls that follow a stop.
- Decision 58's `detail: { abortedBy, reason }` on the step record is the pattern for recording why a hook stopped the run.
- `PauseSignal` / `processCalls` returning `'done'` is how a batch ends early today; a stop is one more `'done'` path.

### Files read (Tasks 5, 7, 8 round, 2026-09-16)

- `packages/agents/src/run/events.ts` - `emit` persists (`store.runs.appendEvent`, contiguous seq) then publishes; a delta is one more event through it.
- `packages/store-file/src/store.ts:172-190` - `appendEvent` appends one JSONL line and enforces `seq === last + 1`; `listEvents` reads them all.
- `packages/papo/src/chat.ts:108-121` - papo iterates `handle.events` only to re-project the transcript from the store; it reads no event payload, so partial text needs a papo change (out of scope, decision 111).
- `packages/papo/src/turns.ts`, `papo/src/blocks.ts:28-35` - the projection already carries a `streaming` flag per prose / reasoning block.
- `packages/agents/src/model/usage.ts`, `types/limits.ts`, `agent/limits.ts`, `types/provider.ts:60-71` - `addUsage`, `Limits`, `DEFAULT_LIMITS`, `ModelInfo.pricing` (the catalogue's shape).
- `packages/agents/src/store/memory.ts:119-130`, `testing/store-conformance.ts:176-190` - where `usage` is persisted and proven per store.
- `packages/model-openai-compat/src/wire.ts:117-141`, `src/types/wire.ts` - `fromWireModel` reads OpenRouter's `pricing.prompt` / `completion`.
- `.project/plans/cli/03-papo-claude/plan.md:94-104`, `deferred.md:14` - the five findings; F1, F2, F4 routed here, F3 to a policy plan.
- `packages/agents/src/run/compact.ts`, `run/context.ts:19-50`, `types/agent.ts:8-24`, `agent/create-agent.ts:11-14,64-67` - `writeSummary`, `groupUnits`, `contextOf`, `ContextOptions` (F1).
- `packages/agents/src/run/run.ts:81-83`, `types/run.ts:7-21` - the input message is minted with `newId()` (F2).
- `packages/agents/src/run/turn.ts:119-125,256,271`, `run/resume.ts:161-178` - the abort exits write nothing; `recover()` is the pattern that answers a cut batch (F4).
- `packages/papo/src/claude/project.ts:12-13,53-60` - Claude Code's interrupt marker and how papo renders it.

### Searches performed (Tasks 5, 7, 8 round)

- `rg "model.delta|handle.events|for await" packages/papo/src` - deltas are consumed nowhere; papo re-projects on every event.
- `rg "usage|pricing" packages/papo/src packages/agents/src/types` - usage is displayed per turn (`turns.ts:74`); pricing exists only on `ModelInfo`.
- `rg "interrupted" packages/papo/src` - `project.ts` already parses `[Request interrupted by user...]`.
- `rg "stream_options|include_usage"` - not used anywhere yet.

### Gaps

- `Not found: any path from a live handle into the transcript` - only `cancel` reaches a running turn. Decision 95 adds it.
- `Not found: a StopReason for a hook that ends the run on purpose` - decision 97.
- `Not found: a stream() on any adapter, an SSE parser, a cost on any record, a compaction tail, a caller-supplied input id, a transcript trace of a cancel` - Tasks 5, 7, 8.
- A cancelled run leaves its tool calls unanswered in the transcript (`processCalls` abort exits), so the next run's history is invalid for Chat Completions; found while reading for F4, fixed by decision 115.

## Decisions locked in

Numbering continues the harness series (p3 ended at 94).

| # | Decision | Rationale / source |
| --- | --- | --- |
| 95 | **Steering.** `RunCommand` gains `{ type: 'steer'; text: string }`. `handle.submit(steer)` on a `running` handle enqueues the text; the loop drains the queue at the top of every model step (after the abort check, before `listMessages`), appends one `role: 'user'`, `source: 'input'` message per steer to the session transcript under the current `runId`, emits `run.steered { message }` per message and resolves the `submit` promise only then. All pending steers drain at once (no one-at-a-time mode: the queue is in the harness, not in a client). A steer that is still queued when the run settles rejects with `AgentError { code: 'not_running' }`; a `submit(steer)` on a closed handle throws the same. `resume()` refuses `steer` as the resuming command (`invalid_options`: "steer needs a live handle; answer the pending request first") but the handle it returns accepts steers once the turn is running again | User (2026-09-16): a person who types during a turn must not have to cancel it; pi's `steeringMode` |
| 96 | `run.steered` is a `RunEvent` (`{ type: 'run.steered'; message: Message }`), persisted and replayed like every other event (decision 61); the message itself lives in the transcript, so `resume()` and context assembly see it without special casing. Ordering guarantee: a steer is always positioned after every tool result of the batch that preceded the drain | (defaulted: the transcript is the boundary; an event that is not in the transcript would be lost on resume) |
| 97 | **A hook can end the run.** `BeforeToolResult` gains `{ decision: 'stop'; reason: string }`; `AfterToolResult` gains `stop?: { reason: string }`. On `beforeTool` stop the call gets the tool result `Not executed: <reason>` (`isError: true`) and no executor runs; on `afterTool` stop the call's own result is recorded as today. In both cases the remaining calls of the batch are answered `Not executed: the run was stopped` (decision 90's rule), the step record of the stopping call carries `detail: { stoppedBy: 'beforeTool' \| 'afterTool', reason }`, and the run finishes `stopped { reason: 'hook' }`. `StopReason` gains `'hook'`; decision 58's `'policy'` stays for `beforeModel` / `afterModel` aborts. A stop from a hook is not a policy refusal: it is `notify_done` / `submit_answer` ending a run on purpose, and a consumer must be able to tell the two apart | pi's `terminate: true`; decision 58, 90 |
| 98 | **Thinking levels.** `ModelParams.reasoning.effort` widens to `'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`; `ModelFeatures.reasoning` stays boolean. `OpenAICompatProviderOptions` gains `reasoningBudgets?: Partial<Record<ReasoningEffort, number>>`; `toWireReasoning` sends `reasoning: { max_tokens }` when `params.reasoning.maxTokens` is set, else `reasoning: { max_tokens: budgets[effort] }` when the provider has a budget for that effort, else `reasoning_effort: effort`. A level a provider does not accept is the provider's error to raise (`invalid_response` / `server` per decision 32), not a client-side clamp | pi's `thinkingLevel` / `thinkingBudgets`; decision 45 |
| 99 | **Dynamic credentials.** `OpenAICompatProviderOptions.apiKey` becomes `string \| (() => string \| Promise<string>)`; a function is called once per `send` attempt (so a retry after `auth` gets a fresh token) and its result is never cached by the provider. `headers` are built per attempt from the resolved key; a static string behaves exactly as today | pi's `getApiKey`; OAuth-issued tokens expire |
| 100 | **Provider cache key.** `ModelRequest` gains `cacheKey: string`, set by the loop to the `sessionId`; the openai-compat adapter sends it as `prompt_cache_key`. It is part of `StepRecord.request` like every other request field | pi's `sessionId`; a session's prefix is stable, so the provider cache should be keyed by it |
| 101 | `AgentErrorCode` gains `'not_running'` (a command that needs a live turn reached a handle whose run is no longer running). Distinct from `not_found` (there is no such run / request) and `interrupted` (the process died) | (defaulted: a consumer resends a rejected steer as a new run only if it can tell "too late" from "wrong id") |

| [102](../../../decisions/model-delta-persisted.md) | **Every `model.delta` is persisted** like every other event: it takes the next seq, is appended to the run's event log and replayed by `resume()` (decision 61 unchanged). Cost accepted: a long answer is thousands of small JSONL lines | User (2026-09-16, asked: persist / live-only channel / coalesce per step) |
| [103](../../../decisions/model-delta-text-and-reasoning.md) | `model.delta` is `{ type: 'model.delta'; step; kind: 'text' \| 'reasoning'; text }`. Tool-call fragments are never published as events (spec: publish safe text deltas, assemble every tool call before anything else) | User (2026-09-16, asked: text and reasoning / text only) |
| [104](../../../decisions/stream-whenever-adapter-can.md) | The loop streams whenever `agent.model.stream` exists and `features.streaming` is true; otherwise `complete()`. No agent option. The compaction summary step always uses `complete()` | User (2026-09-16, asked: whenever the adapter can / agent option) |
| [105](../../../decisions/model-stream-event-shape.md) | `ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `ModelStreamEvent = text.delta \| reasoning.delta \| toolCall.delta { index, callId?, name?, arguments } \| done { reply }`. The adapter assembles tool calls; `done.reply` carries them whole; the loop ignores `toolCall.delta` (it is for a host reading the adapter directly) and validates or executes nothing before `done` | Task outline (the four kinds); user (2026-09-16, asked: keep `toolCall.delta` / drop it) |
| [106](../../../decisions/stream-interruption-fails-step.md) | A stream that ends without `done` is `ModelError { code: 'invalid_response' }`: the step is `failed` (never `uncertain`), the run `failed`, and no assistant message is written, so nothing partial exists to execute on retry. An adapter retries only before the response body starts (decision 32's policy); once bytes are being read nothing is retried | Spec "A stream interruption must not leave a partial call that gets executed on retry"; (defaulted: the retry boundary, since a mid-body retry would re-emit text already published) |
| [107](../../../decisions/openai-compat-streams-with-own-sse.md) | `@facio/model-openai-compat` streams with its own SSE parser (zero deps), `stream: true, stream_options: { include_usage: true }`; usage comes from the last chunk, zeros when absent; a leading `<think>` block in streamed text is split into reasoning deltas like `fromWireResponse` does for the whole. `DEFAULT_FEATURES.streaming` becomes `true`; `features: { streaming: false }` opts a model out | Task outline (own parser); user (2026-09-16, asked: flip the default / stay false); (defaulted: `include_usage` and the `<think>` rule, both the non-streaming behavior carried over) |
| [108](../../../decisions/pricing-on-adapter.md) | **Pricing lives on the adapter.** `ModelPricing { inputPerMillion, outputPerMillion, cacheReadPerMillion?, cacheWritePerMillion?, currency: 'USD' }` (the catalogue's `ModelInfo.pricing` shape, named); `ModelAdapter.pricing?` is set by `provider.model({ id, pricing? })` / `openaiCompat({ pricing })`, the catalogue's value passed through by the host (`model()` is synchronous). `Usage` gains `cacheWriteTokens?`. No pricing means no cost and `maxCost` never trips | User (2026-09-16, asked: adapter with cache rates / adapter input-output only / agent options) |
| [109](../../../decisions/cost-recorded-on-run.md) | **Cost is recorded**: `RunRecord.cost?` (USD) next to `usage`, `cost?` next to `usage` on every `RunOutcome` variant, written with the counters at every run update; `resume()` carries a paused run's cost and recomputes a dead run's from the step log. Formula: `Usage.inputTokens` counts every prompt token (cached ones included; adapters that report them apart add them up); cost = plain input × in + cache reads × (cacheRead ?? in) + cache writes × (cacheWrite ?? in) + output × out, per million, rounded to micro-dollars | User (2026-09-16, asked: recorded / computed on read); (defaulted: the formula and the `inputTokens` convention, needed for one `costOf` across providers) |
| [110](../../../decisions/max-cost-limit.md) | `limits.maxCost` (USD, `0` = none, default `0`), checked at the loop top after `maxSteps`; the step that crosses it completes, the next never starts; outcome `stopped { reason: 'max_cost' }`. `StopReason` gains `'max_cost'` | Task outline; (defaulted: checked where `maxSteps` is, the only place a step is refused) |
| [111](../../../decisions/deltas-stop-at-harness.md) | Deltas stop at the harness in p5: papo keeps re-projecting the store; showing partial text is a `cli` plan (with the steer adoption already owed there) | User (2026-09-16, asked: harness only / include papo) |
| [112](../../../decisions/no-anthropic-api-adapter.md) | **No Anthropic API adapter.** Claude is used only to contra-validate the harness, through papo (`cli/03`); the harness is never a Claude API call. Task 08 is the harness side of that contra-validation: findings F1, F2, F4 (`cli/03` deferred.md); F3 (deny rules) is its own `agent/` plan | User (2026-09-16): "the intent to use claude is just to contravalidate the features"; asked: F1, F2, F4 here and F3 own plan / all four / ask per finding |
| [113](../../../decisions/compaction-keeps-tail.md) | **F1, compaction keeps a tail** (as Claude's runtime): `context.compactKeepTokens` (default 20% of `maxTokens`, `0` keeps nothing) leaves the newest whole units out of the summary; `contextOf` (summary, tail, rest) is exported from `@facio/agents` as "what the model sees of a session" for the projection | User (2026-09-16, asked: summary + tail / summary only with the view exported) |
| [114](../../../decisions/caller-message-id.md) | **F2, the caller's message id**: `RunArgs.messageId?` and `CompactArgs.messageId?` (default `newId()`); a duplicate in the session finishes the handle `failed { code: 'already_exists' }` with no store writes | User (2026-09-16, asked: `messageId` / `inputId` / `uuid`) |
| [115](../../../decisions/cancel-writes-marker.md) | **F4, the cancel trace** (as Claude's runtime): every unanswered call of the cut batch gets `toolResult { content: '[Request interrupted by user for tool use]', isError: true }`, then a `role: 'user', source: 'system'` message `[Request interrupted by user]` is appended; a timeout writes the same; the outcome stays `cancelled` / `stopped { reason: 'timeout' }` | User (2026-09-16, asked: marker + cut results / cut results only) |
| [120](../../../decisions/cancel-denies-pending-request.md) | **F5, a cancel on an awaiting run denies its request** (as ahpd / Claude): `cancel` on a resumed `awaiting` run resolves the pending request `deny { reason: 'The turn was stopped' }` through the host-deny path, then finishes `cancelled` with the marker of 115; decision 86 superseded | User (2026-09-16, asked: harness denies / keep detach); found reading `ahpd/packages/agent-claude/src/session.ts:2420-2445` |
| [121](../../../decisions/compacted-event-after-tokens.md) | **F6, `context.compacted` gains `kept` and `afterTokens`** (Claude's notice says "N tokens to M") | User (2026-09-16, asked: add afterTokens / leave as is); `ahpd/.../session.ts:1735-1750` |

## Proposed architecture

```
packages/agents/src/
  types/command.ts      + steer
  types/hooks.ts        + BeforeToolResult 'stop', AfterToolResult.stop
  types/model.ts        + ReasoningEffort, ModelRequest.cacheKey
  types/outcome.ts      + StopReason 'hook'
  types/event.ts        + run.steered
  errors.ts             + 'not_running'
  run/steering.ts       NEW: SteerQueue, enqueue, drainSteering, rejectSteering
  run/handle.ts         createRunHandle({ ..., steer })
  run/run.ts            steering queue shared by handle and TurnContext
  run/resume.ts         same; validateCommand refuses steer
  run/turn.ts           drain at loop top; stop paths in processCalls; cacheKey in assembleRequest
  run/tools.ts          ToolCallResult { kind: 'stop' }, beforeTool / afterTool stop branches
packages/model-openai-compat/src/
  index.ts              apiKey function, reasoningBudgets, prompt_cache_key
  wire.ts               toWireReasoning(reasoning, budgets)
```

Tasks 5, 7, 8 (2026-09-16):

```
packages/agents/src/
  types/model.ts        + ModelStreamEvent, ModelAdapter.stream?, ModelPricing, ModelAdapter.pricing?, Usage.cacheWriteTokens?
  types/event.ts        model.delta { step, kind, text }
  types/provider.ts     ModelInfo.pricing: ModelPricing; model({ id, features?, params?, pricing? })
  types/limits.ts       + maxCost
  types/outcome.ts      + StopReason 'max_cost'; cost? on every outcome
  types/store.ts        + RunRecord.cost?, runs.update({ cost? })
  types/agent.ts        + context.compactKeepTokens
  types/run.ts          + RunArgs.messageId?, CompactArgs.messageId?
  types/message.ts      + INTERRUPTED, INTERRUPTED_TOOL
  model/cost.ts         NEW: costOf(usage, pricing)
  run/turn.ts           callModel (stream or complete), maxCost check, tally(), interrupt() on abort exits
  run/compact.ts        the retained tail; cost of the summary step
  run/context.ts        contextOf exported
  run/run.ts, resume.ts messageId; counters.cost
  testing/fake-model.ts stream(), pricing
packages/model-openai-compat/src/
  sse.ts                NEW: parseSse
  stream.ts             NEW: streamChunks (assembly, <think> split, usage)
  index.ts              sendStream(), stream(), streaming default true, pricing
  wire.ts               fromWireModel: cache rates
packages/store-file/src/store.ts   run.json carries cost
```

- **Data flow (streaming)** - `callModel` iterates `adapter.stream(request)`: each `text.delta` / `reasoning.delta` becomes a `model.delta` event (persisted, then published) before the next one is read; `toolCall.delta` is skipped; `done.reply` is the reply the rest of the step already handles (`afterModel`, step record, `model.completed`).
- **Data flow (cost)** - after every reply: `counters.usage += reply.usage`, `counters.cost += costOf(reply.usage, adapter.pricing)` when pricing exists; `tally(ctx)` puts `{ usage, steps, cost? }` on every outcome and every `runs.update`.
- **State flow (F4)** - an abort seen at any exit of `processCalls` or at the loop top first writes the cut results and the marker, then `finishRun(abortOutcome)` as today.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Contracts](task-01-contracts.md) | done | - |
| [02 - Steering in the loop](task-02-steering-loop.md) | done | 01 |
| [03 - Stop from `beforeTool` / `afterTool`](task-03-stop-beforetool-aftertool.md) | done | 02 |
| [04 - Provider: effort levels, budgets, dynamic key, cache key](task-04-provider-effort-levels-budgets-dynamic.md) | done | 03 |
| [05 - Streaming](task-05-streaming.md) | todo | 04 |
| [06 - Context reduction and `/compact`](task-06-context-reduction-compact.md) | done | - |
| [07 - Usage accounting](task-07-usage-accounting.md) | todo | 05 |
| [08 - Harness changes from the papo and ahpd contra-validation (F1, F2, F4, F5, F6)](task-08-second-adapter.md) | todo | 07 |

## Cross-layer consistency

| Shape | Source | Consumers |
| --- | --- | --- |
| `RunCommand.steer`, `run.steered` | `types/command.ts`, `types/event.ts` | `run/handle.ts`, `run/steering.ts`, `@facio/chat` (`say` during a turn) |
| `BeforeToolResult.stop`, `AfterToolResult.stop`, `StopReason.hook` | `types/hooks.ts`, `types/outcome.ts` | `run/tools.ts`, `run/turn.ts`, every host that reads outcomes |
| `ReasoningEffort`, `ModelRequest.cacheKey` | `types/model.ts` | `run/context.ts`, `@facio/model-openai-compat`, `@facio/chat` model config |
| `ModelStreamEvent`, `ModelAdapter.stream`, `model.delta.kind` | `types/model.ts`, `types/event.ts` | `run/turn.ts` (`callModel`), `testing/fake-model.ts`, `@facio/model-openai-compat` (`stream.ts`), papo (`cli` plan) |
| `ModelPricing`, `ModelAdapter.pricing`, `Usage.cacheWriteTokens`, `RunRecord.cost`, `RunOutcome.cost`, `Limits.maxCost`, `StopReason.max_cost` | `types/model.ts`, `types/provider.ts`, `types/store.ts`, `types/outcome.ts`, `types/limits.ts` | `model/cost.ts`, `run/turn.ts`, `run/resume.ts`, every store (`memory.ts`, `store-file`), `@facio/model-openai-compat` (`fromWireModel`), papo's turn usage |
| `ContextOptions.compactKeepTokens`, `contextOf` export, `RunArgs.messageId`, `INTERRUPTED` / `INTERRUPTED_TOOL` | `types/agent.ts`, `run/context.ts`, `types/run.ts`, `types/message.ts` | `run/compact.ts`, `run/run.ts`, `run/turn.ts`, papo's projection (`cli` plan reads `contextOf` and the marker) |

## Risks and tradeoffs

1. A steer that arrives while the last model step is in flight is rejected, not silently dropped, and not silently turned into a new run: the consumer decides (`@facio/chat` resends it as a new `say`). Decision 95 makes this explicit; the alternative (the harness starting a new run) would hide a run boundary from the store.
2. `stopped { reason: 'hook' }` puts a purposeful end and a limit in the same status. Consumers that treat `stopped` as "something went wrong" must look at `reason`; the alternative (`completed` with the stopping call's message) would misreport a `beforeTool` stop, where nothing was produced.
3. Widening the effort union means an adapter can receive a level its provider rejects; decision 98 leaves that to the provider's error, the same way an unknown model id is.
4. Persisting every delta (decision 102) grows `events.jsonl` by one line per chunk; `listEvents` and `resume()` replay read it all. Accepted for one contract; a later store may index by seq without changing the contract.
5. A cost computed from provider-reported usage is only as good as the pricing the host passed; `cost` absent means unknown, never zero, so a missing price cannot look free.
6. The compaction tail (decision 113) keeps units the summary also does not describe; the tail is estimated, not measured, so a tail can still overshoot by one unit. The unit is never split, which keeps tool calls next to their results.
7. F2 scans the session's messages for a duplicate id on every `run()` that passes `messageId`; on a long session with the file store that is one read of `messages.jsonl`. Accepted: a run already reads the transcript for its first step.

## Resume state

- **Done so far:** Tasks 1-4 built 2026-09-16 (decisions 95-101 in code: `run/steering.ts`, `run/handle.ts`, `run/run.ts`, `run/resume.ts`, `run/turn.ts`, `run/tools.ts`, `types/*`, `@facio/model-openai-compat` `index.ts` / `wire.ts` / `types/options.ts`; tests `run/steering.test.ts`, `run/hook-stop.test.ts`, `wire.test.ts`; `examples/agents/steer.ts`, `adapter-smoke.ts --effort`); Task 6 built 2026-09-16; Tasks 5, 7, 8 scoped.
- **Planned 2026-09-16:** Tasks 5, 7, 8 in full (decisions 102-115). The former task 08 (an Anthropic Messages API adapter) is void: no `@facio/model-anthropic`, no `agent/04` adapter plan (decision 112).
- **Next action:** `/dooit` [task-05-streaming.md](task-05-streaming.md); then 07, then 08. F3 is [agent/04-policy-rules](../04-policy-rules/plan.md).
- **Open questions:** none.
- **Watch out for:** `@facio/chat` decision 12 (queue) must be amended now that Task 2 shipped: `say` during an attached run → `submit(steer)`, falling back to `say` as a new run on `not_running`; `queue` stays the follow-up queue. papo's `turns.ts` maps every `stopped` outcome to `cancelled`; with `reason: 'hook'` a purposeful end now looks cancelled there, so the `cli` plan that adopts steering should read `reason`. `ahpd` adapter (p4) maps AHP's `queue` to the same split.

## Final verification checklist

- [x] `pnpm check` green (2026-09-16, 60 test files).
- [x] A steer during a tool batch lands after that batch's results and before the next model step; a late steer rejects `not_running`.
- [x] A `beforeTool` / `afterTool` stop leaves every call of the batch with a result and finishes `stopped { reason: 'hook' }`.
- [x] `effort: 'xhigh'` reaches the wire; a budget map turns it into `max_tokens`; an `apiKey` function is called per attempt; `prompt_cache_key` is the session id.
- [x] Tasks 5, 7, 8 planned in full before any of them is built (2026-09-16).
- [ ] A streamed answer arrives as persisted `model.delta` events; an interrupted stream leaves no tool call to execute.
- [ ] A run records `cost` from the adapter's pricing and stops at `maxCost`.
- [ ] After a compaction the model sees summary, tail, input and the event says before and after; a caller-supplied `messageId` is honoured; a cancel leaves the marker, answers the cut calls and denies an open request.
