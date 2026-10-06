---
title: papo drops its edit list
status: todo
depends: [task-02-a-tool-declares-the-file-it-writes.md]
layer: "papo"
refs:
  - "[code://packages/papo/src/agent.ts#L32-L33](../../../../packages/papo/src/agent.ts#L32-L33) - `EDITS`"
  - "[code://packages/papo/src/agent.ts#L80-L86](../../../../packages/papo/src/agent.ts#L80-L86) - `policyOf(..., { inside, isEdit })`"
---

## Objective

papo's `acceptEdits` reads which tools are edits from the tools themselves; `EDITS` is gone.

## Files

- `UPDATE: packages/papo/src/agent.ts:32-33,80-86` - delete `EDITS`; pass `{ inside }` only.
- `UPDATE: packages/papo/src/chat.test.ts` (the `acceptEdits` cases) - unchanged expectations.

## Steps

1. Delete the set and the `isEdit` line.
2. Run the existing `acceptEdits` tests; they must pass as they are.

## Validation

- An in-workspace `edit_file` under `acceptEdits` runs unasked; `shell_exec` asks.
- `pnpm --filter @cofold/papo test` is clean.

## Resume

