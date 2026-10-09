---
title: A run's events are written in the order they were emitted
domain: agent
status: built
priority: high
created: 2026-10-09
revalidated: 2026-10-09
decisions: []
refs:
  - "[code://packages/store-file/src/store.ts#L254-L268](../../../../packages/store-file/src/store.ts#L254-L268) - `appendEvent` awaits the run folder and the lock before it checks `seq`, so two calls on one run interleave"
  - "[code://packages/agents/src/run/events.ts#L17-L30](../../../../packages/agents/src/run/events.ts#L17-L30) - `emit` takes the next `seq` and calls `appendEvent` in the same tick, so call order is `seq` order"
  - "[code://packages/agents/src/store/memory.ts#L188-L195](../../../../packages/agents/src/store/memory.ts#L188-L195) - the memory store checks `seq` before any await, so it never sees the gap"
  - "[code://packages/store-file/src/store.test.ts#L150-L160](../../../../packages/store-file/src/store.test.ts#L150-L160) - the `seq_gap` tests, which append one event at a time"
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan whose task 02 fails on this
---

## Goal

Two events emitted on one run, with the second emitted before the first is written, are both written, in `seq` order.
Today the file store refuses the second with `seq_gap`, and a host that answers a pause during its announcement leaves the run waiting.

## Reconnaissance

### Searches performed

- `rg "appendEvent" packages/*/src` - one caller, `createEmitter`; two stores.
- ahpd plugin/40 on `@cofold/store-file` 0.2.0: a command during the pause announcement gives "expected seq 7, got 8".
- The same ahpd tests pass on the memory store.

### Runtime path

```
emit (seq 7) -> appendEvent awaits requireRunDir
emit (seq 8) -> appendEvent awaits requireRunDir -> reads lastSeq 6 -> seq_gap
```

### Gaps

- `appendEvent` in store-file has no order between two calls on one run.
- No store-file test emits two events on one run without awaiting the first.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The fix is in cofold store-file, not a workaround in ahpd | Softov, 2026-10-09, asked "Where should it be fixed?": "Fix in cofold" | 01 |
| `appendEvent` joins a queue per run at call time, keyed by session and run id, and each call waits for the one before it | (defaulted: the emitter already calls in `seq` order, so the queue keeps that order) | 01 |
| A failed append does not stop the queue; the next call runs and checks `seq` as now | (defaulted: a stuck queue would hang every later event of the run) | 01 |
| The change is tested against ahpd plugin/40 with a packed tarball before Softov releases it | the memory `test-the-consumer-before-a-release` | 02 |

## Proposed architecture

- **State flow** - `createFileStore` keeps the last pending append of each run in a `Map`. An entry goes when its queue is empty, and `delete` and `truncate` drop it with `lastSeq`.
- **Layer responsibilities** - store-file: the order of writes on one run. agents: unchanged.
- **Source-of-truth files** - [`code://packages/store-file/src/store.ts`](../../../../packages/store-file/src/store.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - appendEvent writes one run's events in call order](task-01-append-event-writes-in-call-order.md) | done | - |
| [02 - The change is tested against ahpd before any release](task-02-release-tested-against-ahpd.md) | done | 01 |

## Risks and tradeoffs

- Events of one run are written one at a time; events of different runs still write in parallel.
- A second process appending to the same run is still refused by the writer lock, as now.

## Resume state

- **Done so far:** tasks 01 and 02; see [implemented.md](implemented.md).
- **Next action:** none; the release is Softov's.
- **Open questions:** none.
- **Watch out for:** nothing.

## Final verification checklist

- [x] Two `appendEvent` calls on one run, not awaited between them, both land in `seq` order.
- [x] A real gap still gives `seq_gap`.
- [x] ahpd plugin/40's agent-cofold suite passes against the packed package.
- [x] `plans/index.md` updated.
