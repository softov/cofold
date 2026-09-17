---
title: CLI-05.4 - A message typed while a turn runs, when the turn pauses on a decision before the steer lands, is held and steered into the turn when the decision resumes it; the harness queues a steer on a resumed handle while the request is open
status: accepted
date: 2026-09-17
refs:
  - code://packages/papo/src/chat.ts - `say`: a steer refused `not_running` by a turn that is `awaiting` is queued with `steer: true` and `Started.held`; `steerHeld` submits it on `resume`; `newest` / `inForce` read the writer holder
  - code://packages/papo/src/queue.ts - `Queued.steer`; `startHead` starts one head at a time
  - code://packages/agents/src/run/resume.ts - `steer` on a resumed handle while the request is open is enqueued (decision 95 amended)
  - code://packages/agents/src/run/steering.test.ts - tests 5 and 5b
  - code://packages/papo/src/chat.test.ts - "a steer the turn paused on a decision before taking is held...", "a held steer outlives a cancel...", "a run another process recorded after the paused one does not hide the decision..."
  - code://.project/decisions/papo-steers-and-queues.md - CLI-04.1, the queue this rides on
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/plan.md - decision 95, amended in place
---

## Context

The user's session `27bbb76f` on 2026-09-17: a message sent while a tool ran (a steer, decision 95) met a turn that then asked permission for its next tool.
The harness pauses such a turn `awaiting` and rejects the pending steer `not_running`; papo read that as "the turn ended" and started a new run, which failed at once `writer_busy` because the paused turn keeps the session's writer.
That failed run was then the newest, so the confirmation was hidden, `approve` and `cancel` said "not waiting on anything", and every next message repeated the failure: the session was stuck.
The stuck part is a defect (the turn in force is the one holding the writer, not the newest record).
What the typed message should become needed a decision, and delivering it deterministically needed a harness amendment.

## Decision

papo holds the message: `say` queues it with `steer: true` (shown among the queued rows, `unqueue` drops it) and answers `Started.held`; when the decision resumes the turn (`approve`, `deny`, `answer`), papo submits it as a steer to the resumed handle before the command, so it lands ahead of the turn's next model step.
A held steer whose turn ends before that (a `cancel`) stays queued, held by the cancel as any queued message is, and becomes the next turn once the person speaks again.

The harness's decision 95 is amended: a steer submitted to a `resume()` handle while the request is open is queued, not refused; it is still never the resuming command, it drains at the first model step after the command, and a run that settles first rejects it `not_running`.

Source: user (2026-09-17), asked "A message typed while a turn runs, when the turn then pauses on a permission ask before the steer could land: what should papo do with it?" with "Hold it, deliver on resume", "Refuse it, keep the draft", "Queue it as the next turn": "Hold it, deliver on resume (Recommended)".
Source: user (2026-09-17), asked "How should the held steer reach the resumed turn?" with "Amend 95: queue it while the request is open" and "Keep 95: papo submits after the decision": "Amend 95: queue it while the request is open (Recommended)".

## Consequences

`Queued.steer` and `Started.held` exist; the shell's `session show` marks a held steer `(steer)`.
`Chat.snapshot`, `sessions()` and `say` read the run in force through the session's `activeWriterRunId`, so a stray record after a paused turn no longer hides it; the user's stuck session shows its confirmation again after this change and a deny or cancel releases it.
`startHead` starts one queued head at a time per session, so a settle and a queue that race no longer start two runs against each other.

## Options

Refusing the message (the rule for a message said while a decision is already pending) kept the draft in the field but made the person retype after deciding, and did not match the reference, where a message typed under a permission prompt is delivered afterwards.
Queueing it as the next turn let the model finish the turn without reading it.
Submitting the steer after the decision without the harness amendment left the landing to timing: the turn's continuation and the steer were queued back-to-back, and only the file store's IO made the steer win.
