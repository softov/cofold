---
title: A message during a turn steers it; a queued message is the next turn
status: todo
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

Decision [CLI-04.1](../../../decisions/papo-steers-and-queues.md) in papo: `say` steers a running turn, `queue` holds the next one, the head starts on settle and never after a cancel.

## Files

- `UPDATE: packages/papo/src/chat.ts:237-260` - `say` steers when a run is attached and running.
- `UPDATE: packages/papo/src/chat.ts:108-121` - `attach` starts the queue head on `completed | stopped | failed`.
- `UPDATE: packages/papo/src/chat.ts:281-292` - `cancel` marks the session `held` so the settle callback does not start the head; the deny of a waiting request is removed once decision 120 is in the harness (until then it stays).
- `UPDATE: packages/papo/src/chat.ts` - `queue`, `unqueue`, `queued` on the service; `types/chat.ts` (the service interface) gains them; `Snapshot.queued: Queued[]`.
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

2. Queue. `queueKey(sessionId) = papo/session/<id>/queue`, `Queued = { id, text, settings?: Partial<Settings>, at }[]`. `queue({ sessionId, text, settings? })` appends (or replaces the same `id`) and notifies; `unqueue` removes. In `attach`'s settle callback: when the outcome is `completed | stopped | failed` and the session is not marked `held` by a cancel, shift the head and `say` it (its `settings` applied); a failure to start is `warn`ed and the head stays. `cancel` sets `held` for the session until the next `say` from a person.

3. Shell and screen as in Files. The screen shows queued messages under the composer with their ids; `unqueue` from the palette.

4. Tests: steer during a tool call lands after the tool result (transcript order); steer after the turn settled becomes a new run; queue then settle starts the head; queue then cancel does not; `unqueue` removes; a queued message with settings applies them to its run.

## Validation

- `pnpm check`; `papo` in a terminal: type during an answer, see the message land and the answer continue.

## Resume

