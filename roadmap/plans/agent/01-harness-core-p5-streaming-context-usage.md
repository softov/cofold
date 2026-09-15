<!--
Domain: agent
Status: Planned in part
Priority: Medium
Created: 2026-09-13
Revalidated: 2026-09-16
Dependencies: ./01-harness-core-p3-durable-hitl.md
Parent: ./01-harness-core.md
Reference: ./00-agent.md
-->

# AGENT-01-p5 - Steering, hook stop, thinking levels, streaming, context reduction, usage accounting

_Status: Planned in part · Priority: Medium · Created: 2026-09-13 · Tasks 1-4 planned in full: 2026-09-16_

Child of [01-harness-core.md](01-harness-core.md).
Spec build step 5: "Add streaming, context reduction, usage accounting, and more model adapters as separate increments. Test partial streamed calls and recovery after an uncertain tool invocation."

Tasks 1-4 are planned in full and can be built now; they close the gaps found on 2026-09-16 when comparing the harness against a second agent loop's option surface (steering, a hook that ends the run, thinking levels, dynamic API keys, a provider cache key).
Tasks 5-8 are the spec's increments, scoped here and planned in full by a `/dooplan` round before `/dooit`.

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
- `roadmap/plans/cli/01-facio-chat.md` decision 12 - `@facio/chat` queues a `say` that arrives while a run is attached and sends it after the run finishes. With steering that becomes the follow-up queue only; a `say` during a turn steers.

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

### Gaps

- `Not found: any path from a live handle into the transcript` - only `cancel` reaches a running turn. Decision 95 adds it.
- `Not found: a StopReason for a hook that ends the run on purpose` - decision 97.

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

Tasks 5-8 lock their decisions in their own `/dooplan` round (open questions listed under Resume state).

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

## Phases

### Task 1 - Contracts (decisions 95-101)

- **Files:** `UPDATE: packages/agents/src/types/command.ts`, `types/hooks.ts`, `types/model.ts`, `types/outcome.ts`, `types/event.ts`, `types/contracts.test-d.ts`, `errors.ts`, `UPDATE: packages/agents/src/index.ts` (export `ReasoningEffort`).
- `command.ts`:
  ```ts
  | { type: 'steer'; text: string }
  ```
- `hooks.ts`:
  ```ts
  export type BeforeToolResult =
    | { decision: 'allow' }
    | { decision: 'modify'; input: unknown }
    | { decision: 'deny'; reason: string }
    | { decision: 'approval'; prompt?: string }
    /** Ends the run after this call is answered "Not executed" (decision 97). */
    | { decision: 'stop'; reason: string };
  export type AfterToolResult = { output: ToolOutput; isError?: boolean; /** Ends the run after this result is recorded (decision 97). */ stop?: { reason: string } };
  ```
- `model.ts`:
  ```ts
  export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoning?: { effort?: ReasoningEffort; maxTokens?: number };
  export interface ModelRequest { instructions; messages; tools; params; /** Stable per session; adapters that key a prompt cache use it (decision 100). */ cacheKey: string; signal }
  ```
- `outcome.ts`: `export type StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy' | 'hook';`
- `event.ts`: `| { type: 'run.steered'; message: Message }` after `run.started`.
- `errors.ts`: `| 'not_running'`.
- `contracts.test-d.ts`: a `BeforeToolResult` of `{ decision: 'stop' }` without `reason` fails; `ModelRequest` without `cacheKey` fails; `RunCommand` `steer` without `text` fails.
- **Validation:** `pnpm check` (the loop and the adapter fail typecheck until Tasks 2-4; do Tasks 1-4 in one branch).

### Task 2 - Steering in the loop

- **Files:** `CREATE: packages/agents/src/run/steering.ts`, `UPDATE: run/handle.ts`, `run/run.ts`, `run/resume.ts`, `run/turn.ts`, `CREATE: packages/agents/src/run/steering.test.ts`.
- `steering.ts`:
  ```ts
  export interface Steer { text: string; resolve: () => void; reject: (e: Error) => void }
  export type SteerQueue = Steer[];
  export function enqueueSteer(queue: SteerQueue, text: string): Promise<void> {
    return new Promise((resolve, reject) => queue.push({ text, resolve, reject }));
  }
  /** Appends every queued steer to the transcript, emits run.steered per message, resolves the submitters (decisions 95-96). */
  export async function drainSteering(ctx: TurnContext): Promise<void> {
    const pending = ctx.steering.splice(0);
    if (pending.length === 0) return;
    const messages: Message[] = pending.map((s) => ({ id: newId(), role: 'user', source: 'input', parts: [{ type: 'text', text: s.text }], createdAt: now() }));
    await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages });
    for (const message of messages) await ctx.emit({ type: 'run.steered', message });
    for (const s of pending) s.resolve();
  }
  export function rejectSteering(queue: SteerQueue, runId: string): void {
    for (const s of queue.splice(0)) s.reject(new AgentError({ code: 'not_running', message: `run ${runId} finished before the message was delivered` }));
  }
  ```
- `handle.ts`: `createRunHandle` takes `steer: (text: string) => Promise<void>`; `submit`:
  ```ts
  if (command.type === 'steer') {
    if (closed) throw new AgentError({ code: 'not_running', message: `run ${args.runId} is not running` });
    return args.steer(command.text);
  }
  ```
  before the `onCommand` branch. `finish` unchanged (rejection happens in `settle`, which owns the queue through `ctx`).
- `run.ts:22-32`: `const steering: SteerQueue = [];` before `createRunHandle({ runId, sessionId, abort, steer: (text) => enqueueSteer(steering, text) })`; `setupRun` passes `steering` into `createTurnContext`. `TurnContext` gains `steering: SteerQueue`.
- `resume.ts:30-47`: same queue and `steer` on the handle; `validateCommand` first line: `if (command.type === 'steer') throw new AgentError({ code: 'invalid_options', message: 'steer needs a live handle; answer the pending request first' });` (the `Command` type in `resume.ts` becomes `Exclude<RunCommand, { type: 'cancel' | 'steer' }>` and `onCommand` narrows before `accept`).
- `turn.ts`: in `runTurn`'s loop, after the abort check and before the `maxSteps` check: `await drainSteering(ctx);`. In `settle`: `rejectSteering(ctx.steering, ctx.runId)` before `ctx.handle.finish(outcome)`. Also in `finishDetached` paths of `resume.ts` (no ctx there; the queue is in scope).
- `steering.test.ts` (memory store, fake model that calls a tool once then answers): (1) `submit(steer)` while the tool executes → resolves; the transcript is `user, assistant(toolCall), tool, user(steer), assistant`; `run.steered` appears between `tool.completed` and the second `model.started`. (2) Two steers before the drain → two messages, both promises resolve, order preserved. (3) steer after `run.finished` → throws `not_running`. (4) steer queued while the last model step is in flight and the reply has no tool calls → rejected `not_running`, transcript unchanged. (5) `resume({ command: { type: 'steer' } })` → handle finishes `failed { code: 'invalid_options' }` with no store writes (same shape as decision 92). (6) A resumed run accepts a steer after the approval is applied.
- **Validation:** `pnpm check`; `examples/` gain `examples/steer.ts` (send, steer after the first `tool.started`, print the transcript order).

### Task 3 - Stop from `beforeTool` / `afterTool`

- **Files:** `UPDATE: packages/agents/src/run/tools.ts`, `run/turn.ts`, `CREATE: packages/agents/src/run/hook-stop.test.ts`.
- `tools.ts`: `ToolCallResult` gains `| { kind: 'stop'; part: ToolResultPart; executed: boolean; stoppedBy: 'beforeTool' | 'afterTool'; reason: string }`.
  - `beforeTool` branch (after `deny`, before `modify`): `if (decision.decision === 'stop') { await emit({ type: 'tool.denied', callId, name, reason: decision.reason }); return { kind: 'stop', executed: false, stoppedBy: 'beforeTool', reason: decision.reason, part: { type: 'toolResult', callId, name, content: \`Not executed: ${decision.reason}\`, isError: true } }; }` (no step record: nothing executed, same as a deny).
  - `afterTool` branch (line 109-115): capture `after.stop`; the step patch gains `detail: { stoppedBy: 'afterTool', reason }` when set; `tool.completed` is emitted as today; return `{ kind: 'stop', executed: true, stoppedBy: 'afterTool', reason, part }` instead of `{ kind: 'result' }`.
- `turn.ts` `processCalls`, after the `aborted` check:
  ```ts
  if (result.kind === 'stop') {
    await appendResult(ctx, result.part);
    for (const rest of calls.slice(i + 1)) await appendResult(ctx, { type: 'toolResult', callId: rest.callId, name: rest.name, content: 'Not executed: the run was stopped', isError: true });
    await finishRun(ctx, { status: 'stopped', reason: 'hook', usage: counters.usage, steps: counters.steps });
    return 'done';
  }
  ```
  The counter rule stays: `executed: true` counts, `false` does not (decision 56).
- `applyResolved` (an approved call re-entering `execute`) goes through `afterTool` inside `execute`, so an `afterTool` stop on a resumed call takes the same path; no change needed there beyond the union.
- `hook-stop.test.ts`: (1) `beforeTool` stop on the first of two calls → both calls have `Not executed` results, `tool.denied` for the first only, outcome `stopped { reason: 'hook' }`, `toolCalls` counter 0. (2) `afterTool` stop on a `notify_done` tool → its own result recorded, step `completed` with `detail.stoppedBy: 'afterTool'`, outcome `stopped { reason: 'hook' }`, counter 1. (3) The next `run()` on the session assembles a model-valid history (every `toolCall` has a `toolResult`). (4) `afterTool` stop with `isError: true` still stops.
- **Validation:** `pnpm check`.

### Task 4 - Provider: effort levels, budgets, dynamic key, cache key

- **Files:** `UPDATE: packages/model-openai-compat/src/index.ts`, `src/wire.ts`, `src/wire.test.ts`, `src/index.test.ts`, `UPDATE: packages/agents/src/run/turn.ts` (`assembleRequest` sets `cacheKey: sessionId`), `packages/agents/src/run/context.ts` (signature), `UPDATE: packages/model-openai-compat/README.md`.
- `index.ts`:
  ```ts
  apiKey?: string | (() => string | Promise<string>);
  /** Token budget per effort, for providers that take max_tokens instead of a level (decision 98). */
  reasoningBudgets?: Partial<Record<ReasoningEffort, number>>;
  ```
  `send`: `const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey;` inside the attempt loop; `headers` built per attempt (`{ ...baseHeaders, ...(key ? { authorization: \`Bearer ${key}\` } : {}) }`). The request body gains `prompt_cache_key: request.cacheKey`.
- `wire.ts`:
  ```ts
  export function toWireReasoning(reasoning: NonNullable<ModelParams['reasoning']>, budgets: Partial<Record<ReasoningEffort, number>> = {}): Record<string, unknown> {
    if (reasoning.maxTokens !== undefined) return { reasoning: { ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}), max_tokens: reasoning.maxTokens } };
    const budget = reasoning.effort !== undefined ? budgets[reasoning.effort] : undefined;
    if (budget !== undefined) return { reasoning: { max_tokens: budget } };
    return reasoning.effort !== undefined ? { reasoning_effort: reasoning.effort } : {};
  }
  ```
- Tests: `wire.test.ts` covers the three branches and every effort value; `index.test.ts` with an injected `fetch`: the key function is called once per attempt (`auth` is not retried under decision 32, so a 401 means one call; a 500-then-200 sequence means two calls), `prompt_cache_key` equals the request's `cacheKey`.
- **Validation:** `pnpm check`; `examples/adapter-smoke.ts` gains a `--effort xhigh` flag and prints the wire body against the injected fetch.

### Task 5 - Streaming (outline; `/dooplan` before `/dooit`)

- `ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `text.delta`, `reasoning.delta`, `toolCall.delta`, `done { reply }`; the loop publishes `model.delta` for text immediately and assembles every tool call completely before validation or execution. A stream that ends before `done` records the step `failed`, never `uncertain` (spec: "A stream interruption must not leave a partial call that gets executed on retry"). `openaiCompat` implements SSE with its own parser (zero-deps rule). Open: whether `model.delta` is persisted (decision 61 says every event is; deltas are many and cheap) or coalesced into one event per step in the log.

### Task 6 - Context reduction and `/compact` (outline)

- `context.strategy`: default `recent` (decision 60); `summarize` produces a `Message` with `source: 'summary'` stored in the session next to the originals, carrying `summarizes: messageId[]`, the model id and `createdAt`; the assembler takes the summary when the originals exceed the budget. `RunHandle`-level `compact` is a run whose only step is the summary. `AgentOptions.context.autoCompactTokens?: number` triggers it before a step when the estimate exceeds the threshold. Open: the exact `Message` shape for a summary (a part type or a field), and whether `resume()` needs to know about it (it should not: the transcript is complete without the summary).

### Task 7 - Usage accounting (outline)

- `Usage` accumulated per run in `RunRecord.usage` (exists since p2); add `limits.maxCost` with `ModelAdapter.pricing?: { inputPerMillion; outputPerMillion }` → `stopped { reason: 'max_cost' }`. Open: whether pricing lives on the adapter or on `AgentOptions` (the catalogue, decision 44, is where the provider reports it; the adapter is the natural carrier).

### Task 8 - Second adapter (outline)

- `@facio/model-anthropic` (Messages API: system top-level, tool results as user content blocks, `stop_reason` mapping, thinking blocks → `ReasoningPart`, `cacheKey` → cache control on the system block) to prove the contract is not shaped by Chat Completions.

## Cross-layer consistency

| Shape | Source | Consumers |
| --- | --- | --- |
| `RunCommand.steer`, `run.steered` | `types/command.ts`, `types/event.ts` | `run/handle.ts`, `run/steering.ts`, `@facio/chat` (`say` during a turn) |
| `BeforeToolResult.stop`, `AfterToolResult.stop`, `StopReason.hook` | `types/hooks.ts`, `types/outcome.ts` | `run/tools.ts`, `run/turn.ts`, every host that reads outcomes |
| `ReasoningEffort`, `ModelRequest.cacheKey` | `types/model.ts` | `run/context.ts`, `@facio/model-openai-compat`, `@facio/chat` model config |

## Risks and tradeoffs

1. A steer that arrives while the last model step is in flight is rejected, not silently dropped, and not silently turned into a new run: the consumer decides (`@facio/chat` resends it as a new `say`). Decision 95 makes this explicit; the alternative (the harness starting a new run) would hide a run boundary from the store.
2. `stopped { reason: 'hook' }` puts a purposeful end and a limit in the same status. Consumers that treat `stopped` as "something went wrong" must look at `reason`; the alternative (`completed` with the stopping call's message) would misreport a `beforeTool` stop, where nothing was produced.
3. Widening the effort union means an adapter can receive a level its provider rejects; decision 98 leaves that to the provider's error, the same way an unknown model id is.
4. Tasks 5-8 are still outlines; the plan's status stays `Planned in part` until their round.

## Resume state

- **Done so far:** Tasks 1-4 planned in full 2026-09-16; Tasks 5-8 scoped.
- **Next action:** `/dooit` Tasks 1-4 as one branch (typecheck is only green after Task 4); then `/dooplan` Tasks 5-8.
- **Open questions (Tasks 5-8 round):** `model.delta` persistence; summary `Message` shape; `pricing` location; SSE parser (own).
- **Watch out for:** `@facio/chat` decision 12 (queue) must be amended once Task 2 ships: `say` during an attached run → `submit(steer)`, falling back to `say` as a new run on `not_running`; `queue` stays the follow-up queue. `ahpd` adapter (p4) maps AHP's `queue` to the same split.

## Final verification checklist

- [ ] `pnpm check` green.
- [ ] A steer during a tool batch lands after that batch's results and before the next model step; a late steer rejects `not_running`.
- [ ] A `beforeTool` / `afterTool` stop leaves every call of the batch with a result and finishes `stopped { reason: 'hook' }`.
- [ ] `effort: 'xhigh'` reaches the wire; a budget map turns it into `max_tokens`; an `apiKey` function is called per attempt; `prompt_cache_key` is the session id.
- [ ] Tasks 5-8 planned in full before any of them is built.
