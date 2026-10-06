---
title: 122 - A run's handle answers its own pause
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/agents/src/run/handle.ts#L56](../../packages/agents/src/run/handle.ts#L56) - a `run()` handle refuses approve, deny and answer with `not_found`; only `resume()` installs a command channel"
  - "[code://packages/agents/src/run/turn.ts#L391-L401](../../packages/agents/src/run/turn.ts#L391-L401) - `pause()` announces the request before the run is recorded `awaiting`, then settles the handle"
  - "[code://packages/agents/src/run/run.ts#L91-L99](../../packages/agents/src/run/run.ts#L91-L99) - a setup failure before the turn context exists, or a `finishRun` that throws, finishes the handle with no `run.finished`"
  - "[code://packages/agents/src/run/resume.ts#L139-L179](../../packages/agents/src/run/resume.ts#L139-L179) - `waitForCommand`, the wait the paused run reuses"
  - "[code://packages/papo/src/chat.ts#L215-L228](../../packages/papo/src/chat.ts#L215-L228) - `handleFor`, papo's resume after its own pause"
  - file:///github/ahpd/packages/agent-cofold/src/pauses.ts - `owePause`, `payPause`, `rejoin` and `route`: ahpd's helper that waits for the pause and rejoins
  - file:///github/ahpd/packages/agent-cofold/src/runs.ts - lines 186-190 record the pause, lines 215-226 synthesize a missing `run.finished`
---

## Context

A `run()` handle takes no command once its run pauses: `submit` of an approve, deny or answer throws `not_found` and says to use `resume()`.
Every host that answers in the same process therefore resumes its own run: papo through `handleFor`, ahpd through `owePause`, `payPause`, `rejoin` and `route`.
`pause()` also announces `approval.requested` before the run is recorded `awaiting`, so an answer sent the moment the request is seen can find a run that is not yet waiting.
Two failure paths end a handle with no `run.finished` event, and ahpd synthesizes one.
pi answers inside the live run through its async `tool_call` hook, and the Claude Agent SDK through its async `canUseTool`.

## Decision

The handle `run()` returns takes approve, deny and answer across its own pause, and the run continues on that same handle; `resume()` stays for a run another process left.
The request and the `awaiting` record are written before `approval.requested` or `input.requested` is emitted.
Every handle's event stream ends with a `run.finished` carrying its outcome, including a setup failure before the turn context exists and a `finishRun` that throws.

The handle's `outcome` resolves once, when the run really ends; it never resolves with `awaiting` at a pause.
A host that stops at a pause reads `run.paused` or `run.finished { awaiting }` from `events`, and the stored event log keeps its shape.

Source: Softov, 2026-10-06, asked "Which cofold plans should I write?": chose "A: a run answers its own pause", with Softov's direction that pi's SDK and the Claude Agent SDK implement these things inside the SDK, so cofold should too.
Source for `outcome`: Softov, 2026-10-06, asked "once a run's handle answers its own pause, should the handle's `outcome` still resolve with `awaiting` at a pause?": "Resolve once, at the end".

## Consequences

A host answers the handle it already holds, so papo's `handleFor` resume of its own pause and ahpd's pause bookkeeping can go.
A handle no longer ends at a pause, so a host that leaves at a pause stops reading at the pause's events rather than at the end of the stream.
The wait for a command is one piece of code that `run()` and `resume()` share.
A host that drops a paused handle and exits leaves the run `awaiting` in the store, and `resume()` reaches it as before.

## Options

Resolving `outcome` with `awaiting` at the pause, as today, with a new outcome promise for each continuation, was rejected: a promise settles once, so a host would have to fetch a fresh promise after every answer, and the final outcome is what a live host waits for.
A separate helper that waits for the pause and rejoins it with `resume()` was rejected: it is what ahpd built in `pauses.ts`, every host would carry the same sequence, and the gap between the pause and the rejoin stays a race the helper has to paper over.
