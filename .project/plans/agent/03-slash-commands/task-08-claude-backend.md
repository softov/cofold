---
title: The Claude backend lists its own commands
status: todo
depends: [task-05-papo-service.md, task-07-papo-shell.md]
layer: papo
refs:
  - "[code://packages/papo/src/claude/chat.ts#L356-L359](../../../../packages/papo/src/claude/chat.ts#L356-L359) - `skills()` maps `supportedCommands()`"
  - "[code://packages/papo/src/claude/chat.ts#L110-L130](../../../../packages/papo/src/claude/chat.ts#L110-L130) - the `autoCompact` default and refusal"
  - "[code://packages/papo/src/claude/chat.ts#L312](../../../../packages/papo/src/claude/chat.ts#L312) - `compacting` is set from `COMPACT_COMMAND`"
  - "[code://packages/papo/src/claude/project.ts#L122-L125](../../../../packages/papo/src/claude/project.ts#L122-L125) - `isCommandEcho`"
---

## Objective

On the Claude backend, `commands()` is the CLI's list, `skills()` is empty, and `say('/x')` goes to the CLI unchanged.

## Files

- `UPDATE: packages/papo/src/claude/chat.ts` - `commands()`, empty `skills()`, remove `compact()`, the `autoCompact` setting.
- `UPDATE: packages/papo/src/claude/chat.test.ts` - the cases under Validation.

## Steps

1. Write `commands()` from `supportedCommands()`, with `kind: 'runtime'`, and an empty `argumentHint` as none.
2. Make `skills()` return an empty list.
3. Remove `compact()`; keep `COMPACT_COMMAND` for the `compacting` flag at L312.
4. Queue a slash line typed during a turn, as on the cofold backend.
5. Remove the `autoCompact` refusal in `checkSettings` and the pinned default, because Claude's `/autocompact` is Claude's.

## Validation

- `chat.test.ts`: `commands()` returns the fixture's list, and `skills()` returns none.
- `chat-contract.test.ts` passes on both backends.
- `pnpm --filter @cofold/papo test` passes.

## Resume
