---
title: CLI-04.1 - A message typed during a turn steers it; a queued message becomes the next turn
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/chat.ts#L237-L260 - `say` throws `writer_busy` while a run is attached
  - code://ahpd/packages/sdk/src/types/session.ts#L244-L294 - `steer`, `queue`, `unqueue`, `reorder`: the queue is the session's, not a client's
  - code://ahpd/packages/agent-claude/src/session.ts#L2299-L2345,L2431-L2445 - ahpd's steer, queue (`startNext`), and "deliberately not startNext" after a cancel
  - code://.project/decisions/no-anthropic-api-adapter.md - decision 95 (p5, steer in the harness) and its watch-out for papo
---

## Context

The harness takes steers (decision 95, `submit({ type: 'steer' })`); papo still refuses a `say` while a run is attached. Claude's runtime and ahpd both steer the running turn and hold a queue of messages that become the next turns, and a cancel does not start the queue.

## Decision

`say` during a running attached turn sends `submit({ type: 'steer', text })`; on `not_running` (the turn settled first) it starts a new run with the same text. `queue(sessionId, text, settings?)` and `unqueue(sessionId, id)` hold messages in the session's kv (`papo/session/<id>/queue`); when a run settles `completed | stopped | failed`, the service starts the head as a new `say`; after a `cancel`, or when the run ends `awaiting`, nothing starts. The screen offers steer (default) or queue for a message typed while running; the shell gets `queue` and `unqueue`.

Source: user, 2026-09-16, asked "Steer + queue (Claude) / Steer only".

## Consequences

`writer_busy` on `say` disappears for a running turn (an `awaiting` one still refuses: answer it first). The queue survives the process (kv), as ahpd's does not; a resumed session starts its head on the next settle.
