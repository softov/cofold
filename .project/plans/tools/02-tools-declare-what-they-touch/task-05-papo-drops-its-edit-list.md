---
title: papo drops its edit list
status: done
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

- **Built:** `EDITS` is deleted from `packages/papo/src/agent.ts` and `policyOf` is now given `{ inside }` alone, with a comment saying why papo keeps no list of tool names. Nothing else in papo names the edit tools: `types/config.ts` still describes the mode in terms of `write_file` / `edit_file`, which is what its own `files()` capability contributes, so it is left as it is.
- **Validation:** `chat.test.ts`'s `acceptEdits` case (line 715) is unchanged and passes: an in-workspace `write_file` (spelled `sub/../out.txt`) and `edit_file` run unasked, a `write_file` outside the workspace and a `shell_exec` still ask. It passed before the change too, by design - the point of the task is that the same behaviour now comes from the tools rather than from papo's table; `mode.test.ts`'s `isEdit` default cases in `@cofold/agents` are what prove the source moved.
- **Checks:** `pnpm --filter @cofold/papo exec vitest run --typecheck` 141 pass, 8 files, no type errors. One run of the full suite timed out on the screen's `/compact` case at the 5 s limit under load; the file alone and the next full run both passed (3794 ms for that case), so it is a slow-test flake, not this change.

