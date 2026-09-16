---
title: Harness changes from the papo and ahpd contra-validation (F1, F2, F4, F5, F6)
status: todo
depends: [task-07-usage-accounting.md]
layer: agents
refs:
  - code://.project/plans/cli/03-papo-claude/plan.md#L94-L104 - the findings table; Claude's runtime is the reference (cli/03 decision 10)
  - code://.project/plans/cli/03-papo-claude/deferred.md#L14 - routes F1, F2, F4 here and F3 to a policy plan
  - code://packages/agents/src/run/compact.ts#L36-L90 - `writeSummary`: `covered` is every message no summary stands for, minus the turn's input; the tail is carved out of it (F1)
  - code://packages/agents/src/run/context.ts#L19-L50 - `groupUnits`, `summarizedIds`, `contextOf` (summary first, then what no summary covers); `contextOf` is exported for the view (F1)
  - code://packages/agents/src/types/agent.ts#L8-L24 - `ContextOptions` / `ResolvedContext`; `compactKeepTokens` joins `autoCompactTokens`
  - code://packages/agents/src/agent/create-agent.ts#L11-L14,L64-L67 - `DEFAULT_CONTEXT` and the option validation
  - code://packages/agents/src/types/run.ts#L7-L21 - `RunArgs` / `CompactArgs`; `messageId` is added (F2)
  - code://packages/agents/src/run/run.ts#L81-L83 - the input message is minted with `newId()` and `inputMessageId` written to the run record (F2)
  - code://packages/agents/src/store/memory.ts#L79-L83 - `appendMessages` does not check ids; the uniqueness check is the loop's (F2)
  - code://packages/agents/src/run/turn.ts#L119-L125 - `abortOutcome`: `cancelled` or `stopped { reason: 'timeout' }`, nothing written (F4)
  - code://packages/agents/src/run/turn.ts#L256,L271 - the two abort exits of `processCalls` (before a call, and `result.kind === 'aborted'` after one); neither answers the batch (F4)
  - code://packages/agents/src/run/resume.ts#L161-L178 - `recover()` answers an interrupted batch (`execution outcome unknown`, `not executed: the run was interrupted`); the same shape is used on cancel (F4)
  - code://packages/papo/src/claude/project.ts#L12-L13,L53-L60 - the marker Claude Code writes (`[Request interrupted by user]`, `... for tool use`) and how papo already renders it as a notice
---

## Objective

Five places where the harness differed from Claude's runtime in the papo and ahpd contra-validation now behave as Claude's does: a compaction keeps a verbatim tail, exposes what the model sees and reports before and after tokens; the caller may supply the input message id; a cancelled run leaves a marker, answers the tool calls it cut, and denies the request it was waiting on.

## Coverage of the outline

The original task 08 (an Anthropic Messages API adapter) was not the intent: Claude is used to contra-validate the harness through papo (`cli/03`), never called as an API (user, 2026-09-16).
This task holds the harness changes that contra-validation found; F3 (deny rules) is [agent/04-policy-rules](../04-policy-rules/plan.md).

## Files

- `UPDATE: packages/agents/src/types/agent.ts:8-24` - `ContextOptions.compactKeepTokens?`, `ResolvedContext.compactKeepTokens`.
- `UPDATE: packages/agents/src/agent/create-agent.ts:11-14,64-67` - default and validation.
- `UPDATE: packages/agents/src/run/compact.ts:36-90` - the tail is left out of `covered`.
- `UPDATE: packages/agents/src/run/context.ts:45-50` - `contextOf` keeps summary, tail, rest in transcript order.
- `UPDATE: packages/agents/src/index.ts` - export `contextOf`.
- `UPDATE: packages/agents/src/types/run.ts:7-21` - `RunArgs.messageId?`, `CompactArgs.messageId?`.
- `UPDATE: packages/agents/src/run/run.ts:64-93` - use it; refuse a duplicate.
- `UPDATE: packages/agents/src/run/turn.ts:119-125,249-286` - `interrupt(ctx, calls, from)` on every abort exit.
- `UPDATE: packages/agents/src/types/message.ts:33-34` - the marker texts as exported constants next to `MessageSource`.
- `UPDATE: packages/agents/src/run/compact.test.ts`, `CREATE: packages/agents/src/run/interrupt.test.ts`, `UPDATE: packages/agents/src/run/run.test.ts` (F2 cases).
- `UPDATE: packages/agents/README.md` - compaction tail, `messageId`, cancel marker.

## Steps

1. F1, the retained tail (decision 113). `ContextOptions.compactKeepTokens?: number` with `/** Newest messages kept verbatim after a summary, estimated; default 20% of maxTokens. 0 keeps nothing. */`; `create-agent.ts` fills `compactKeepTokens: Math.floor(context.maxTokens / 5)` when absent and refuses a negative value (`invalid_options`). In `writeSummary`, after `covered` is computed: the units of `groupUnits(covered)` are walked newest first and moved to `kept` while their estimate fits in `compactKeepTokens`; a unit is never split; `covered` becomes the rest; `summarizes` lists only `covered`. The step's `detail` gains `kept: kept.length`. `contextOf` is unchanged in shape (summary first, then every message no summary stands for, in transcript order), which now yields summary, tail, current input. `historyEstimate` is unchanged. `contextOf` is exported from `index.ts` as the one function that answers "what does the model see of this session", for papo's projection (`cli` plan).

2. F2, the caller's message id (decision 114). `RunArgs.messageId?: string` and `CompactArgs.messageId?: string` with `/** The input message's id; default newId(). A client that supplies it can match run.started to its send. Must be new in the session. */`. `setupRun` uses `args.messageId ?? newId()`; before `store.runs.create`, when `args.messageId` is given, `store.sessions.listMessages({ sessionId })` is scanned and a hit finishes the handle `failed { code: 'already_exists' }` with no store writes (the same handle-only shape as decision 92). `RunRecord.inputMessageId` and `run.started.input.id` carry it; nothing else changes.

3. F4, the interrupt marker (decision 115). `types/message.ts` exports:

   ```ts
   /** What a cancelled run writes (Claude's runtime's wording, so one projection reads both). */
   export const INTERRUPTED = '[Request interrupted by user]';
   export const INTERRUPTED_TOOL = '[Request interrupted by user for tool use]';
   ```

   `turn.ts` gains:

   ```ts
   /** Answers the calls a cancel cut and writes the marker, so the transcript stays model-valid and says what happened (decision 115). */
   async function interrupt(ctx: TurnContext, calls: ToolCallPart[], from: number): Promise<void> {
     for (const call of calls.slice(from)) await appendResult(ctx, { type: 'toolResult', callId: call.callId, name: call.name, content: INTERRUPTED_TOOL, isError: true });
     const marker: Message = { id: newId(), role: 'user', source: 'system', parts: [{ type: 'text', text: INTERRUPTED }], createdAt: now() };
     await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages: [marker] });
   }
   ```

   Call sites: `processCalls` line 256 (abort seen before call `i`: `interrupt(ctx, calls, i)`) and line 271 (`result.kind === 'aborted'` after call `i`: the executor was cut, `interrupt(ctx, calls, i)`); the loop top (line 155, abort between steps: `interrupt(ctx, [], 0)`, marker only). A timeout is an abort too and writes the same texts (`abortOutcome` decides `cancelled` vs `stopped { reason: 'timeout' }` as today). The marker is `role: 'user', source: 'system'` so `contextOf` and papo's projection treat it like the `/compact` ask: shown as a notice, sent to the model as context (Claude sends it too). Nothing is written when the abort is seen in `setupRun` before `run.started` (no turn to mark).

4. Tests. `compact.test.ts` gains: with `compactKeepTokens` large enough for the last unit, `summarizes` leaves it out and the next request carries summary, tail, input in that order; `compactKeepTokens: 0` covers everything (today's behavior); a unit is never split. `run.test.ts` gains: `messageId` given → `run.started.input.id`, `RunRecord.inputMessageId` and the transcript agree; a second `run()` with the same id fails `already_exists` with no new run record. `interrupt.test.ts`: cancel during the first of two calls → transcript `user, assistant, tool(INTERRUPTED_TOOL), tool(INTERRUPTED_TOOL), user(system: INTERRUPTED)`, tool step `uncertain`, outcome `cancelled`; cancel between steps → marker only; timeout → same texts, outcome `stopped { reason: 'timeout' }`; a `run()` after each assembles a valid history (every call answered) and the model sees the marker.

4. F5, a cancel on an awaiting run denies its request ([120](../../../decisions/cancel-denies-pending-request.md)). In `run/resume.ts` `waitForCommand`, `onAbort` no longer calls `finishDetached(abortOutcome(ctx))`: it takes the request as `accept` would with the command `{ type: 'deny', requestId: pending.requestId, reason: 'The turn was stopped' }` (persist through `store.requests.resolve`, emit `approval.resolved { decision: 'deny' }` or `input.declined`, `runs.update({ status: 'running' })`, `run.resumed`), then continues the turn with `runTurn(ctx, { kind: 'batch', calls: remaining, resolved })` so `applyResolved` writes the call's error result, and the loop's next abort check (already set) writes the cut results and the marker of step 3 and finishes `cancelled`. A cancel before `attach()` has read the run keeps today's behavior (nothing to deny yet; the handle finishes `cancelled` detached, request open) and is documented as such. `resume.test.ts`: the "cancel while waiting detaches" cases become "cancel while waiting denies": request `resolvedAt` set, `approval.resolved deny` in the log, transcript answered, outcome `cancelled`, a later `resume()` replays a terminal run. cli/01 decision 6's own deny in papo is removed by cli/04.

5. F6, the compaction notice ([121](../../../decisions/compacted-event-after-tokens.md)). `types/event.ts`: `context.compacted { messageId, summarized, kept, estimatedTokens, afterTokens }`; `writeSummary` computes `afterTokens` as `historyEstimate(ctx, [...history, summary])` after appending the summary (the estimate of `contextOf` with the summary in place) and `kept` from step 1. `compact.test.ts` asserts both.

## Coverage of the ahpd read (2026-09-16)

`ahpd/packages/sdk/src/types/session.ts` (whole) and `agent-claude/src/session.ts` (steering 695-740, 2290-2320; compaction 1720-1750; `uuid` 1760-1780; cancel 2420-2445; usage 778-790) were read against decisions 95, 113, 114, 115: steer and `uuid` match; compaction matches plus F6; cancel gave F5. ahpd's "a cancel does not start the queue" belongs to papo's queue (cli/04).

## Validation

- `pnpm check`.
- papo over `@facio/agents` after this task: `/compact` then a turn shows the summary, the tail and the ask; an `interrupt` shows the same notice papo already renders for the Claude backend (manual, `cli` plan adopts `contextOf` for the view).

## Resume

