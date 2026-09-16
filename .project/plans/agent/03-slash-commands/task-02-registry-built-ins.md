---
title: The registry, the interception in start(), and compact as a command
status: todo
depends: [task-01-contracts.md]
layer: agents
refs:
  - code://packages/agents/src/run/run.ts#L29-L58
  - code://packages/agents/src/run/compact.ts
  - code://packages/agents/src/run/context.ts#L46
---

## Objective

`createAgent` resolves `slashCommands`; `run({ input: '/compact' })` is a command run that writes the `command` message, the summary and the `notice`, and finishes `completed` with no model step; `listSlashCommands(agent)` lists the built-in; an unknown `/name` reaches the model as text; `contextOf` drops `command` and `notice`.

## Files

- `CREATE: packages/agents/src/run/slash.ts` - `parseSlash(input): { name; args } | undefined`, `listSlashCommands(agent): SlashCommandInfo[]`, `BUILTIN_SLASH_COMMANDS: SlashCommand[]` (holding `compactCommand`), `runSlashCommand(ctx, command)` (the messages and events of decision 5).
- `UPDATE: packages/agents/src/agent.ts` - `createAgent` merges the definition's commands with the built-ins; a duplicate name faults `AgentError('already_exists')` (decision 3). Capability commands are resolved per run where capabilities are (`run/turn.ts` `resolveCapabilities`), as tools are.
- `UPDATE: packages/agents/src/run/compact.ts` - the step becomes `compactCommand.run`; delete the exported `compact()` run and `COMPACT_INPUT` (decision 4).
- `UPDATE: packages/agents/src/run/run.ts:29-58` - `start()` loses `compacting`; after the writer claim and before the input message, `parseSlash` and the lookup; a hit takes the command path (decision 5), a miss continues as today (decision 6).
- `UPDATE: packages/agents/src/run/turn.ts` - the auto-compact branch calls the same compaction step.
- `UPDATE: packages/agents/src/run/context.ts:46` - `command` and `notice` are left out of the request (decision 7).
- `UPDATE: packages/agents/src/index.ts` - export `listSlashCommands`; delete the `compact` export.

## Steps

1. `parseSlash`: the pattern of decision 5 on a string input or a single text part; `args` trimmed, `''` when absent.
2. The command path in `start()`: store the input message `{ role: 'user', source: 'command', parts: [{ type: 'text', text: <the line as typed> }] }`; emit `run.started`; emit `command.started`; `await command.run({ agent, session, args, store, signal, emit })`; when text came back store `{ role: 'user', source: 'notice', parts: [{ type: 'text', text }] }`; emit `command.finished`; finish `completed` with `message` the notice (or the input when there was none), `usage` zero, `steps` 0. A throw finishes `failed` with the error and writes no notice. The writer claim is released as for every turn.
3. `compactCommand`: `{ name: 'compact', description: 'Fold the conversation so far into a summary the model continues from', run }` where `run` does what `compact()` did (the summary message, `context.compacted`) and returns `'Compacted'`.
4. `contextOf`: skip `command` and `notice`.

## Validation

- `CREATE: packages/agents/src/run/slash.test.ts` (6): `/compact` on a session with history (messages `command`, `summary`, `notice`; outcome `completed`; no model request); `/nothing` reaches the fake model as text; a definition command with args returns output and the transcript shows both; a capability command is listed and runs; a throwing command → `failed` and no notice; `contextOf` leaves `command` and `notice` out.
- `UPDATE: packages/agents/src/run/compact.test.ts` - through `run({ input: '/compact' })`.
- `pnpm check`.

## Resume

