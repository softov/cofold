---
title: appendEvent writes one run's events in call order
status: done
depends: []
layer: "store-file"
refs:
  - "[code://packages/store-file/src/store.ts#L254-L268](../../../../packages/store-file/src/store.ts#L254-L268) - `appendEvent`, which gets the queue"
  - "[code://packages/store-file/src/store.ts#L128-L146](../../../../packages/store-file/src/store.ts#L128-L146) - `delete` and `truncate`, which drop `lastSeq` entries"
  - "[code://packages/store-file/src/store.test.ts#L150-L160](../../../../packages/store-file/src/store.test.ts#L150-L160) - the `seq_gap` tests"
---

## Objective

Concurrent `appendEvent` calls on one run are written in the order they were called, and a real gap still fails with `seq_gap`.

## Files

- `UPDATE: packages/store-file/src/store.ts:254-268` - `appendEvent` waits for the run's previous append before it reads `lastSeq`.
- `UPDATE: packages/store-file/src/store.ts:128-146` - `delete` and `truncate` drop the run's queue entries with `lastSeq`.
- `UPDATE: packages/store-file/src/store.test.ts` - tests for concurrent appends on one run.

## Steps

1. Add a `Map` from `${sessionId}/${runId}` to the run's last pending append in `createFileStore`.
2. In `appendEvent`, chain the call on that entry before the first await, and store the new promise.
3. Make the chain continue after a rejected append, and return each call's own result.
4. Remove the entry when the stored promise is still the last one after it settles.
5. Drop the run's entries in `delete` and `truncate`.
6. Add a test that calls `appendEvent` for seq 1, 2 and 3 without awaiting, then awaits all three.
7. Add a test that a failed append does not stop the next one on the same run.
8. Run `pnpm check`.

## Validation

- `store.test.ts`: three appends started together land as 1, 2, 3 in `listEvents`.
- `store.test.ts`: after a `seq_gap` failure, the next correct append succeeds.
- `store.test.ts`: the current `seq_gap` tests pass unchanged.
- `pnpm check` passes.

## Resume

`appendEvent` chains each call on a per-run queue in `createFileStore` (`appends`, keyed by encoded session and run id); the write itself is `writeEvent`. Two tests added in `store.test.ts`; `pnpm check` passes. Next: task 02.
