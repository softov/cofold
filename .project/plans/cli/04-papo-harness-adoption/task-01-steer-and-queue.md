---
title: A message during a turn steers it; a queued message is the next turn
status: done
depends: []
layer: papo
refs:
  - code://packages/papo/src/chat.ts#L15-L43 - `Attached`, the `attached` map, `settingsKey`, `notify`
  - code://packages/papo/src/chat.ts#L108-L121 - `attach`, where the settle callback starts the queue head
  - code://packages/papo/src/chat.ts#L237-L260 - `say`
  - code://packages/papo/src/chat.ts#L281-L292 - `cancel`; its own deny goes once p5 task 08 ships decision 120
  - code://packages/papo/src/commands.ts#L113,L205,L282 - the `say`, `cancel`, `session.set` actions the new ones sit next to
  - code://packages/papo/src/screen/chat.tsx#L141 - `onSubmit` → `controller.send(value)`
  - code://ahpd/packages/sdk/src/types/session.ts#L244-L294 - the reference contract
---

## Objective

`say` steers a running turn (decision 95; papo refusing `writer_busy` was the gap); a queue holds the next turns in memory, the head starts on settle and never after a cancel ([CLI-04.1](../../../decisions/papo-steers-and-queues.md)).

## Files

- `UPDATE: packages/papo/src/chat.ts:237-260` - `say` steers when a run is attached and running.
- `UPDATE: packages/papo/src/chat.ts:108-121` - `attach` starts the queue head on `completed | stopped | failed`.
- `UPDATE: packages/papo/src/chat.ts:281-292` - `cancel` marks the session `held` so the settle callback does not start the head; the deny of a waiting request is removed once decision 120 is in the harness (until then it stays).
- `UPDATE: packages/papo/src/chat.ts:15-43` - `Attached.queue: Queued[]` (in memory, next to the handle and the draft); `queue`, `unqueue`, `queued` on the service; `types/chat.ts` (the service interface) gains them; `Snapshot.queued: Queued[]`.
- `UPDATE: packages/papo/src/commands.ts` - `queue <session> <text...>`, `unqueue <session> <id>`; `session show` prints the queue.
- `UPDATE: packages/papo/src/screen/chat.tsx:141` and `screen/state.ts` - `send` while running: steer by default; `alt+enter` (or the composer chip "Queue") queues; the queue is listed under the composer.
- `UPDATE: packages/papo/src/chat.test.ts`, `chat-contract.test.ts` - the scenarios below on both backends where the Claude backend supports them (steer yes; queue: the Claude backend keeps its own queue in memory, cli/03).
- `UPDATE: packages/papo/README.md`.

## Steps

1. `say`: replace the `running && attached` refusal with

   ```ts
   const held = attached.get(sessionId);
   if (run?.status === 'running' && held !== undefined) {
     try { await held.handle.submit({ type: 'steer', text }); return { sessionId, runId: held.handle.runId, steered: true }; }
     catch (e) { if ((e as AgentError).code !== 'not_running') throw e; /* the turn settled first: fall through to a new run */ }
   }
   ```

   `Started` gains `steered?: true`. An `awaiting` run still refuses (`writer_busy`, answer it first).

2. Queue. `Queued = { id, text, settings?: Partial<Settings>, at }`; the list lives on the session's `Attached` entry (in memory: it dies with the process, as ahpd's does, CLI-04.1). `queue({ sessionId, text, settings? })` appends (or replaces the same `id`) and notifies; `unqueue` removes; a session with no attached handle gets an entry holding only the queue. In `attach`'s settle callback: when the outcome is `completed | stopped | failed` and the session is not marked `held` by a cancel, shift the head and `say` it (its `settings` applied); a failure to start is `warn`ed and the head stays. `cancel` sets `held` for the session until the next `say` from a person.

3. Shell and screen as in Files. The screen shows queued messages under the composer with their ids; `unqueue` from the palette.

4. Tests: steer during a tool call lands after the tool result (transcript order); steer after the turn settled becomes a new run; queue then settle starts the head; queue then cancel does not; `unqueue` removes; a queued message with settings applies them to its run.

## Validation

- `pnpm check`; `papo` in a terminal: type during an answer, see the message land and the answer continue.

## Resume

- **Done (2026-09-16):** `say` on a session whose newest run is `running` and attached submits `{ type: 'steer', text }` and returns `{ sessionId, runId, steered: true }`; `not_running` falls through to a new run with the same text; an `awaiting` run still refuses `writer_busy`.
  `Chat` gains `queue({ sessionId, text, settings?, id? })`, `unqueue(sessionId, id)` and `queued(sessionId)`; `Snapshot.queued: Queued[]`; `Queued = { id, text, settings?, at }` in `types/chat.ts`.
  `cancel` holds the session (`queues.hold`) and a person's `say` releases it; the settle callback (`handle.outcome.then`) calls `queues.settled(sessionId, status)`, which starts the head on `completed | stopped | failed` only, leaves it in place with a `warn` when `say` throws, and `remove` clears the list.
  `projectTurns` renders a second `input` message of a run as `{ kind: 'steer' }`; `toBlocks(turns, model, queued)` maps it to textui's `said` block and appends a `queued` block per waiting message (`queued:<id>`).
  Shell: `queue <session> <text> [-i ID] [-m -p -t -a]`, `unqueue <session> <id>`; `session show` ends with `Queued:` and one line per message; `renderTurn` prints a steer as `> text`; `toMarkdown` as `**You, while it ran:**`.
  Screen: `enter` steers (unchanged call, the service decides); a `Queue` chip leads the composer row while running and runs `chat.queue` with the draft; the composer shows `N queued`; `enter` on a queued row is `unqueue`; palette `chat.queue` (running only) and `chat.unqueue` (a picker of what waits); `/status` counts the queue.
  Claude backend: `say` while the turn runs pushes the message into the process's prompt stream (the reference's steer, ahpd `session.ts` `steer`), remembers its uuid in `Live.pushed`, and returns `steered: true`; a result with `queued_turn_count > 0` means the CLI kept the message for a turn of its own, so the entry stays running with a new deferred turn for it; `compact` refuses `writer_busy` while running; the same `createQueues` list, started from `handle`'s result and from the process's end.
  The fake SDK reads its prompt into an inbox, hands what arrived during a tool to the model with the tool result (as the CLI takes a steer), takes `FakeToolReply.waitFor` to hold a tool open, and answers `interrupt()` during one with `aborted_tools` and the CLI's cut tool result.
  `gateTool()` in `src/testing.ts` holds a harness turn open (`entered()`, `release()`).
- **Evidence:** `pnpm vitest run --project @cofold/papo`: 8 files, 101 tests green; `pnpm check` 66 files, 736 tests green; `chat.test.ts` 16 (steer lands after the tool result and before the next model step, verified in the fake model's last request; a steer the cancel beat becomes a new run; queue, edit by id, unqueue, settle starts the head with its settings, cancel holds), `claude/chat.test.ts` 20, `chat-contract.test.ts` 22 (`steer`, `queue`, `queue after cancel` on both backends), `commands.test.ts` 8, `screen.test.ts` 10 (the chip, the queued row, the steer, the head starting).
  While the harness's compaction was being changed in another session (agent/01-p5 task 08, the tail), `chat.test.ts` "compacts a session into a summary turn..." saw `[summary, input, model, input]` instead of `[summary, input]` for one run; against the dist `pnpm check` built it passes.
  That assertion is the model's view after a compaction, which cli/04 task 03 owns; it will move when task 08 lands.
- **Deviations:** the queue is not a field on `Attached` but `createQueues()` in `src/queue.ts` (interfaces `Queues`, `QueueDeps` in `types/chat.ts`), one list per session in a map, because both backends need the same behaviour and the rule is one definition; the entry-without-a-handle case of step 2 is simply a list with no handle.
  `alt+enter` is not bound to queue: `@textui/widgets`'s `TextArea` takes `alt+enter` (and `ctrl+enter`) as a newline before any key binding sees it, and textui is not modified; the plan's alternative, the composer chip, is built, plus `/queue`.
  A new `TurnPart` kind was needed for the steer in the transcript and the plan names none: `{ kind: 'steer'; id; text }` (the harness's word, `run.steered`), rendered as textui's `said` block.
  A name to confirm.
  `screen/state.ts` is unchanged: the queue rides in the snapshot (`SNAPSHOT/queued`), so no path of its own was needed.
  A queued message on an idle session (no turn to settle) first waited for the next settle, as step 2's "entry holding only the queue" read; the reference (ahpd `queue`, `startNext`) starts it at once when idle.
  Answered (user, 2026-09-16, "Start at once when idle"; recorded in CLI-04.1): `Queues.add` is async and, when `QueueDeps.idle(sessionId)` says nothing runs or waits and no cancel holds the session, starts the head through the same `start` the settle uses; both backends supply `idle` (`chat.ts`: no `awaiting` run and no `running` run attached here; `claude/chat.ts`: no live process running and no decision pending).
  Tests: `chat.test.ts` "a message queued while nothing runs starts at once, unless a cancel holds the session", `chat-contract.test.ts` "queue while idle" on both backends; the shell test now queues against a session waiting on a decision and sees the head start after `approve`.
- **Found against the reference (to check, cli/03 decision 10):** on the Claude backend a steered message is recorded by the CLI as a user message and projected as a turn boundary after the tool result; on the harness it is a part inside the run (decision 95).
  Same transcript order, different turn shape; the contract asserts the order.
  Whether the real CLI takes a mid-turn message into the running turn (ahpd's claim, what the fake does) or as its next turn (`queued_turn_count`) is handled either way but was not run against the real CLI in this session.
- **Not run:** the terminal check of *Validation* (type during an answer in `papo`).

