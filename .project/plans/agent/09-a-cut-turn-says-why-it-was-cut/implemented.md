---
title: A cut turn says why it was cut - implemented
date: 2026-10-15
refs:
  - git://bf457e5
  - "[code://packages/agents/src/message/markers.ts](../../../../packages/agents/src/message/markers.ts)"
  - "[code://packages/agents/src/run/turn.ts](../../../../packages/agents/src/run/turn.ts)"
---

A turn cut by a reasoned cancel or a timeout now names the reason in the transcript.
The caller can choose both texts with the run option `interrupted`.

## What was built

- [`code://packages/agents/src/message/markers.ts`](../../../../packages/agents/src/message/markers.ts) - `interruptedText(abort)`, the defaults.
- [`code://packages/agents/src/types/abort.ts`](../../../../packages/agents/src/types/abort.ts) - `InterruptText` and `Interrupted`.
- [`code://packages/agents/src/types/run.ts`](../../../../packages/agents/src/types/run.ts) - `interrupted` on `RunArgs`, `CompactArgs` and `ResumeArgs`.
- [`code://packages/agents/src/run/turn.ts`](../../../../packages/agents/src/run/turn.ts) - `interrupt` writes `ctx.interrupted(ctx.abort.reason())`.
- [`code://packages/papo/src/chat.ts`](../../../../packages/papo/src/chat.ts) - `keepMarker`, so papo keeps `INTERRUPTED` and `INTERRUPTED_TOOL`.

## Verified

- `interrupt.test.ts` has six new cases: no reason, a reason, the caller's `AbortSignal`, the defaults, `interrupted` on `run`, and `interrupted` on `compact`.
- `resume.test.ts` has one new case: `interrupted` on `resume` replaces the marker.
- `pnpm typecheck` and `pnpm test` pass, with 1027 tests in 77 files.
- papo compacts through `run` with `/compact`, so `keepMarker` covers its compaction too.
- ahpd's tests do not check the marker text.

## Departures from the plan

- none.

## Left for later

- Crash recovery texts, and ahpd's own texts - see [deferred.md](deferred.md).
