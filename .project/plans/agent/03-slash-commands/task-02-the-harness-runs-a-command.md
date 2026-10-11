---
title: The harness runs a runtime command, and /compact is one
status: todo
depends: [task-01-contracts.md]
layer: agents
refs:
  - "[code://packages/agents/src/agent/create-agent.ts#L35-L47](../../../../packages/agents/src/agent/create-agent.ts#L35-L47) - the `invalid_options` checks a duplicate name copies"
  - "[code://packages/agents/src/run/run.ts#L71-L115](../../../../packages/agents/src/run/run.ts#L71-L115) - `setupRun`, where a line is recognized"
  - "[code://packages/agents/src/run/compact.ts#L24-L80](../../../../packages/agents/src/run/compact.ts#L24-L80) - `compact()` and the ask in `writeSummary`"
  - "[code://packages/agents/src/run/turn.ts#L221-L233](../../../../packages/agents/src/run/turn.ts#L221-L233) - the loop's compact branch"
  - "[code://packages/agents/src/run/context.ts#L45-L50](../../../../packages/agents/src/run/context.ts#L45-L50) - `contextOf`"
---

## Objective

`run({ input: '/compact' })` compacts the session, and a program's runtime command runs as a turn with no model step.
The transcript holds the typed line as a `command` message and the output as a `notice` message, and no request carries either.

## Files

- `UPDATE: packages/agents/src/agent/create-agent.ts` - resolve `Agent.slashCommands` from the options, the capabilities and the built-ins.
- `CREATE: packages/agents/src/run/slash.ts` - `parseSlash`, `listSlashCommands`, and the built-in `compact`.
- `UPDATE: packages/agents/src/run/run.ts:71-115` - recognize a runtime command in `setupRun`, and run it.
- `UPDATE: packages/agents/src/run/compact.ts:24-80` - `compact()` calls `run()` with `/compact`; `writeSummary` always sends a new ask.
- `UPDATE: packages/agents/src/run/turn.ts:221-233` - after the summary of a `/compact` run, write the notice `Compacted`.
- `UPDATE: packages/agents/src/run/context.ts:45-50` - `contextOf` leaves out `command` and `notice` messages.
- `UPDATE: packages/agents/src/index.ts` - export `listSlashCommands`.
- `CREATE: packages/agents/src/run/slash.test.ts` - the cases under Validation.

## Steps

1. In `createAgent`, join `options.slashCommands`, each capability's `slashCommands` and the built-ins, in that order.
2. Fail `createAgent` with `invalid_options` on a duplicate name or a name that does not match the pattern.
3. Write `parseSlash(input)`: a string or one text part that matches the pattern gives `{ name, args }`; anything else gives `undefined`.
4. Write `listSlashCommands(agent)`, which returns `SlashCommandInfo` with `kind: 'runtime'` for each command.
5. In `setupRun`, after `resolveCapabilities`, look up `parseSlash(args.input)` in `agent.slashCommands`.
6. For a match, write the input message with `source: 'command'` and the text as typed.
7. For a match other than `compact`, emit `command.started`, call `run(ctx)`, and write a `notice` message when text comes back.
8. Then emit `command.finished` and finish the run `completed`, with `ZERO_USAGE` and no step.
9. When `run(ctx)` throws, finish the run `failed` with no notice.
10. For `compact`, set `ctx.compact` and go on to `runTurn`, so `writeSummary` makes its one model step.
11. In `writeSummary`, always send a new `system` ask, and add the run's input message to `summarizes` in a `compact` run.
12. In the turn's compact branch, write the `notice` message `Compacted` and emit `command.finished` before the run finishes.
13. Make `compact(args)` call `run()` with the input `/compact` and the same `messageId` and `signal`.
14. In `contextOf`, leave out `command` and `notice` messages.
15. Update the comments in `resume.ts` that name a `compact()` run.

## Validation

- `slash.test.ts`: a program command writes `command` and `notice`, emits both events in order, and makes no model request.
- `slash.test.ts`: `/compact` writes `command`, `summary` and `notice`, and its one request has the new ask as its last message.
- `slash.test.ts`: a later request carries neither the `command` nor the `notice` message.
- `slash.test.ts`: `/unknown x` goes to the model as text; a command that throws ends the run `failed`.
- `slash.test.ts`: a duplicate name fails `createAgent` with `invalid_options`.
- The existing `compact()` tests pass, with the input now `/compact`.
- `pnpm --filter @cofold/agents test` passes.

## Resume
