---
title: A run answers its own pause
domain: agent
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
decisions:
  - decisions/run-handle-answers-its-own-pause.md
  - decisions/cancel-denies-pending-request.md
  - decisions/papo-holds-a-steer-across-a-decision.md
refs:
  - "[code://packages/agents/src/run/handle.ts#L18-L19](../../../../packages/agents/src/run/handle.ts#L18-L19) - `onCommand`: \"Absent on a run() handle\""
  - "[code://packages/agents/src/run/handle.ts#L56](../../../../packages/agents/src/run/handle.ts#L56) - `submit` throws `not_found`, \"use resume()\""
  - "[code://packages/agents/src/run/turn.ts#L335-L344](../../../../packages/agents/src/run/turn.ts#L335-L344) - `processCalls` pauses on an approval or an input and returns `done`"
  - "[code://packages/agents/src/run/turn.ts#L388-L401](../../../../packages/agents/src/run/turn.ts#L388-L401) - `pause()`: request, `approval.requested`, `awaiting`, `run.paused`, `run.finished`, settle"
  - "[code://packages/agents/src/run/turn.ts#L154-L174](../../../../packages/agents/src/run/turn.ts#L154-L174) - `finishRun` emits `run.finished`; `settle` closes the handle"
  - "[code://packages/agents/src/run/turn.ts#L270-L280](../../../../packages/agents/src/run/turn.ts#L270-L280) - the loop's catch: `superseded` and a throwing `finishRun` end in `settle` with no event"
  - "[code://packages/agents/src/run/run.ts#L91-L99](../../../../packages/agents/src/run/run.ts#L91-L99) - setup failure: `handle.finish` with no event when there is no context, or when `finishRun` throws"
  - "[code://packages/agents/src/run/resume.ts#L32-L33](../../../../packages/agents/src/run/resume.ts#L32-L33) - `liveResumes`, the runs attached in this process"
  - "[code://packages/agents/src/run/resume.ts#L139-L179](../../../../packages/agents/src/run/resume.ts#L139-L179) - `waitForCommand`: the acceptor, the cancel that denies (decision 120), the persisted command"
  - "[code://packages/agents/src/run/resume.ts#L254-L276](../../../../packages/agents/src/run/resume.ts#L254-L276) - `validateCommand`"
  - "[code://packages/agents/src/run/abort.ts#L16-L17](../../../../packages/agents/src/run/abort.ts#L16-L17) - the run's timeout timer, which keeps a process alive"
  - "[code://packages/agents/src/types/run.ts#L38-L47](../../../../packages/agents/src/types/run.ts#L38-L47) - `RunHandle`; `events` \"ends after run.finished\""
  - "[code://packages/papo/src/chat.ts#L142-L167](../../../../packages/papo/src/chat.ts#L142-L167) - `attach` detaches when `outcome` settles, which today is the pause"
  - "[code://packages/papo/src/chat.ts#L215-L256](../../../../packages/papo/src/chat.ts#L215-L256) - `handleFor`, `steerHeld`, `submitTo`"
  - "[code://packages/papo/src/commands.ts#L203-L210](../../../../packages/papo/src/commands.ts#L203-L210) - `papo say` waits for the outcome and stops at `awaiting`"
  - "[code://examples/agents/pause-resume.ts#L22-L27](../../../../examples/agents/pause-resume.ts#L22-L27) - process 1 reads the events to the end, then the `awaiting` outcome"
  - "[code://packages/agents/README.md#L87-L111](../../../../packages/agents/README.md#L87-L111) - *Pause and resume*"
  - file:///github/ahpd/packages/agent-cofold/src/pauses.ts - lines 55-125, `owePause`, `payPause`, `rejoin`, `route`: the workaround this plan makes unnecessary
  - file:///github/ahpd/packages/agent-cofold/src/runs.ts - lines 186-190 record the pause, lines 215-226 synthesize a missing `run.finished`
---

## Goal

A host answers an approval or a question on the handle `run()` gave it, and the run goes on there, as pi and the Claude Agent SDK answer inside the live run.
A request is announced only once the run is recorded waiting for it, and every handle's stream ends with a `run.finished`, so no host has to guess how a run ended.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg -n "code://packages/agents/src/run/(handle|run|turn|resume).ts" .project/` - older task refs only (p5, agent/03, agent/04) and decision 120; nothing plans this change.
- `rg -n "onCommand|use resume" packages/agents/src` - only `resume()` passes `onCommand`.
- `rg -n "awaiting" packages examples --type ts` - the hosts that read the `awaiting` outcome: `examples/agents/pause-resume.ts`, `examples/agents/ask-user.ts`, papo's `commands.ts` and `chat.ts`.
- `rg -n "papo.chat.wait" packages/papo/src` - four callers in `commands.ts` (lines 203, 210, 345, 566).

### Runtime path

```
run() -> start -> setupRun -> runTurn -> processCalls -> pause:
  requests.create -> runs.update(awaiting) -> approval.requested | input.requested -> run.paused -> run.finished(awaiting)
  -> wait (handle.submit approve | deny | answer, or cancel) -> approval.resolved | input.resolved | input.declined -> run.resumed
  -> the rest of the batch -> model loop -> run.finished(final) -> handle.outcome
```

### Gaps

- A `run()` handle takes no command after its pause.
- `approval.requested` is emitted before `runs.update(awaiting)`.
- No `run.finished` on four paths: setup failure before the context, `finishRun` throwing (setup and loop), and `superseded`.
- `Not found: a shared wait for a command - searched "waitForCommand" in packages/agents/src.` It lives inside `resume()`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [122 - A run's handle answers its own pause](../../../decisions/run-handle-answers-its-own-pause.md) | Softov, 2026-10-06, chose "A: a run answers its own pause" |
| 2 | [120 - A cancel on an awaiting run denies its pending request and finishes the run cancelled](../../../decisions/cancel-denies-pending-request.md) | applies unchanged to a live pause |
| 3 | [CLI-05.4 - A message typed while a turn runs, when the turn pauses on a decision before the steer lands, is held and steered into the turn when the decision resumes it](../../../decisions/papo-holds-a-steer-across-a-decision.md) | still holds for a run another process paused |

The choices below are tasks.

| What | Source | Task |
| --- | --- | --- |
| `waitForCommand`, `validateCommand` and the set of runs attached in this process move out of `resume.ts` into one module both `run()` and `resume()` use | decision 122 | 01 |
| The run waits at its pause on the live handle and continues the batch there; `resume()` is for a run this process does not hold | decision 122 | 02 |
| `requests.create` and `runs.update(awaiting)` come before `approval.requested` / `input.requested`, and the acceptor is installed before either is emitted | decision 122; [`code://packages/agents/src/run/turn.ts#L394-L397`](../../../../packages/agents/src/run/turn.ts#L394-L397) | 02 |
| At a pause the handle emits `run.paused` and `run.finished { awaiting }` and its `status()` is `awaiting`; `outcome` resolves once, when the run really ends, and `events` ends after the final `run.finished`; a host that stops at a pause reads it from `events` | decision 122; Softov, 2026-10-06, asked "should the handle's `outcome` still resolve with `awaiting` at a pause?": "Resolve once, at the end" | 02, 04, 05 |
| A steer sent while the run waits is queued and lands at the first model step after the command, as on a resumed handle | decision 95 as amended 2026-09-17, in [`code://packages/agents/src/run/resume.ts#L61-L68`](../../../../packages/agents/src/run/resume.ts#L61-L68) | 02 |
| The heartbeat stops at the pause and starts again with the command; the writer claim is kept | decision 62, as `pause()` and `resume()` do today | 02 |
| The run's timeout timer is `unref()`'d, so a host that leaves a paused handle can exit; the wait counts toward `timeoutMs`, as it does under `resume()` | (defaulted: the timer only exists to stop work that keeps the process alive anyway) | 02 |
| Every handle ends with a `run.finished`: when the run did not publish one, the handle publishes one itself, not stored, with the next seq | decision 122 | 03 |
| papo answers, denies and cancels through the handle it holds; `handleFor`'s resume after its own pause goes, and a resume remains only for a run this process does not hold | decision 122; Softov, 2026-10-06 (the brief: "papo drops handleFor in the same plan") | 04 |
| ahpd drops `pauses.ts`'s `owePause`, `payPause`, `rejoin`, `route` and `runs.ts`'s pause bookkeeping and synthesized `run.finished`, after a cofold release, in an ahpd plan | Softov, 2026-10-06 (the brief) | 06 |

## Proposed architecture

- **Data flow** - unchanged: the request record, the run record and the event log are written as today, in a different order at the pause.
- **Event flow** - pause: `approval.requested` | `input.requested`, `run.paused`, `run.finished { awaiting }`; then, on the same handle, `approval.resolved` | `input.resolved` | `input.declined`, `run.resumed`, and the rest of the run up to the final `run.finished`.
- **State flow** - the handle's `status()` goes `running`, `awaiting`, `running`, then the final status; `outcome` resolves once, at the end.
- **Layer responsibilities** - agents: the wait, the order, the always-present `run.finished` · papo: answer the held handle · examples and README: the new shape.
- **Source-of-truth files** - [`code://packages/agents/src/run/turn.ts`](../../../../packages/agents/src/run/turn.ts), [`code://packages/agents/src/run/handle.ts`](../../../../packages/agents/src/run/handle.ts)

```ts
// packages/agents/src/run/answer.ts (new): what run() and resume() share
export const liveRuns: Set<string>;
/** Resolves with the persisted command, or undefined once the run was finished meanwhile (a failed write). */
export function waitForCommand(ctx: TurnContext, pending: PendingRequest): Promise<Command | undefined>;
export function validateCommand(ctx: TurnContext, pending: PendingRequest, command: Command): void;
```

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The wait for a command is shared](task-01-the-wait-for-a-command-is-shared.md) | todo | - |
| [02 - The run waits at its pause on its own handle](task-02-the-run-waits-at-its-pause.md) | todo | 01 |
| [03 - Every handle ends with run.finished](task-03-every-handle-ends-with-run-finished.md) | todo | 02 |
| [04 - papo answers the handle it holds](task-04-papo-answers-the-handle-it-holds.md) | todo | 02, 03 |
| [05 - The examples and the README](task-05-the-examples-and-the-readme.md) | todo | 02, 03 |
| [06 - ahpd drops its pause workarounds](task-06-ahpd-drops-its-pause-workarounds.md) | todo | 04, 05, a cofold release |

## Risks and tradeoffs

- A handle no longer ends at a pause: a host that awaits `outcome` or reads `events` to the end and expected to stop at `awaiting` now waits for the answer; the in-repo ones are changed in tasks 04 and 05, and the README says so.
- Two waiters on one request in one process are refused, because the live run is in the attached set; a same-process `resume()` of a run whose `run()` handle is still waiting gets `writer_busy`, which is why the example's "second process" becomes a real child process.
- `run.finished { awaiting }` stays mid-stream, so `events` no longer "ends after run.finished"; the doc comment on `RunHandle.events` changes with it.
- A synthesized `run.finished` is not in the store; `resume()` on that run reads the record, as before.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-wait-for-a-command-is-shared.md](task-01-the-wait-for-a-command-is-shared.md).
- **Open questions:** none.
- **Watch out for:** `exactOptionalPropertyTypes` (conditional spreads, never `key: undefined`); `processCalls` must continue the same `calls` array after the command, not re-read the transcript, so the rest of the batch keeps its order; `settle` is no longer the pause's last step, so the steering queue must not be rejected at a pause.

## Final verification checklist

- [ ] A `run()` that pauses on an approval takes `approve` on the same handle and completes there; the tool runs once.
- [ ] An answer submitted from an `onEvent` observer of `approval.requested` is taken.
- [ ] Each of the four paths without a `run.finished` today ends its stream with one.
- [ ] `examples/agents/pause-resume.ts` and `ask-user.ts` run.
- [ ] papo: approve, deny, answer and cancel on a paused turn work in one process and after a restart.
- [ ] `pnpm check` in cofold is clean.
- [ ] `plans/index.md` updated.
