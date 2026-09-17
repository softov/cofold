---
title: CLI-04.1 - papo holds a queue of next turns in memory; the head starts when a turn settles, never after a cancel
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/chat.ts#L237-L260 - `say` throws `writer_busy` while a run is attached; steering (decision 95) replaces that, cli/04 task 01
  - code://ahpd/packages/sdk/src/types/session.ts#L244-L294 - `steer`, `queue`, `unqueue`, `reorder`: the queue is the session's, not a client's
  - code://ahpd/packages/agent-claude/src/session.ts#L2299-L2345,L2431-L2445 - ahpd's queue (`startNext`, in memory) and "deliberately not startNext" after a cancel
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/plan.md#L106 - decision 95, steer in the harness
---

## Context

The harness takes steers (decision 95); papo refusing a `say` while a run is attached is a gap, closed in cli/04 task 01.
What needed deciding is whether papo also keeps a queue of messages that become the next turns, as Claude's runtime and ahpd do, and where that queue lives.

## Decision

papo keeps a queue per session, in memory, next to the attached handle: `queue(sessionId, text, settings?)` and `unqueue(sessionId, id)`.
When a run settles `completed | stopped | failed`, the service starts the head as a new `say`; after a `cancel`, or when the run ends `awaiting`, nothing starts.
A message queued while nothing runs or waits on the session starts at once, through the same `say` the settle uses (ahpd's `startNext`: "idle now means this is not a queue at all"); a session held by a `cancel` still waits until the person speaks.
The queue dies with the process, as ahpd's does.
The screen offers steer (default) or queue for a message typed while running; the shell gets `queue` and `unqueue`.

Source: user, 2026-09-16, asked "Steer + queue (Claude) / Steer only" and "In memory, like ahpd / Persist in kv".
Source: user, 2026-09-16, asked "cli/04 task 01 built the queue so that a message queued on an IDLE session (no run attached) waits for the next settle. ahpd (the reference) starts it at once when nothing is running. Which should papo do?": start at once when idle.

## Consequences

`writer_busy` on `say` disappears for a running turn (an `awaiting` one still refuses: answer it first).
A message queued and not started before papo exits is lost; the screen shows the queue so the person knows what is pending.

## Options

Steer only left a second message with nowhere to go but the running turn.
Persisting the queue in kv diverged from the reference for no stated need.
