---
title: The shell lists commands and loses the compact action
status: todo
depends: [task-05-papo-service.md]
layer: papo
refs:
  - "[code://packages/papo/src/commands.ts#L337-L351](../../../../packages/papo/src/commands.ts#L337-L351) - the `compact <session>` action, on the CLI and MCP surfaces"
  - "[code://packages/papo/src/commands.ts#L512-L522](../../../../packages/papo/src/commands.ts#L512-L522) - `skills`, the pattern for `commands`"
  - "[code://packages/papo/src/chat-contract.test.ts#L180-L199](../../../../packages/papo/src/chat-contract.test.ts#L180-L199) - the compact scenario"
---

## Objective

`papo commands` lists the runtime's commands, `papo say -s <id> /compact` compacts, and the contract test checks both on the cofold backend.

## Files

- `UPDATE: packages/papo/src/commands.ts:337-351` - remove the `compact` action from the CLI and MCP surfaces.
- `UPDATE: packages/papo/src/commands.ts:512-522` - add `commands` beside `skills`, with `effect: 'read'`.
- `UPDATE: packages/papo/src/commands.test.ts` - replace the compact test at L323.
- `UPDATE: packages/papo/src/chat-contract.test.ts:180-199` - the scenario uses `say('/compact')`; a new `commands` scenario.
- `UPDATE: packages/papo/README.md` - say which commands are runtime and which are client.

## Steps

1. Remove the `compact` action.
2. Add the `commands` action in the `setup` group, with `effect: 'read'`.
3. Make `session show` print a `command` message as the line and a `notice` as a quoted line.
4. Change the contract scenario to `say('/compact')`: a turn whose input is `/compact`, a `summary` part and a `notice` part.
5. Add a `commands` scenario that finds `compact`.
6. Update the README.

## Validation

- `commands.test.ts`: `papo commands` lists `compact` and `status`.
- `chat-contract.test.ts` passes on the cofold backend.
- `pnpm --filter @cofold/papo test` passes.

## Resume
