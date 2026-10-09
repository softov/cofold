---
title: "Implemented: a run's events are written in the order they were emitted"
---

# Implemented: a run's events are written in the order they were emitted

## What exists now

`appendEvent` in `packages/store-file/src/store.ts` chains each call on a queue per run, keyed by the encoded session and run id.
The write itself is `writeEvent`, which keeps the old body.
`delete` and `truncate` clear the queue entries of what they remove.

## What was verified

- Two tests in `packages/store-file/src/store.test.ts`: calls not awaited between them land in `seq` order, and a real gap still gives `seq_gap`.
- `pnpm check` passes with 967 tests.
- ahpd plugin/40's agent-cofold suite ran against the packed package: 17 failures went to 2, and no `seq_gap` failure is left. The 2 are the dangling-link rows, which come from tools 0.3.0.

## Departures from the plan

None. The version is unchanged; the release is Softov's.
