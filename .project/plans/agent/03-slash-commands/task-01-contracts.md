---
title: The slash command contracts
status: todo
depends: []
layer: agents
refs:
  - code://packages/agents/src/types/command.ts
  - code://packages/agents/src/types/message.ts#L34
---

## Objective

`SlashCommand`, `SlashCommandContext` and `SlashCommandInfo` exist in `@facio/agents`, an agent definition and a capability can carry commands, a message can be a `command` or a `notice`, and the two events are typed. Nothing runs yet.

## Files

- `CREATE: packages/agents/src/types/slash-command.ts` - `SlashCommand { name; description; argumentHint?; run(ctx): Promise<string | undefined> }`, `SlashCommandContext { agent; session; args; store; signal; emit }`, `SlashCommandInfo { name; description; argumentHint? }` (decision 2).
- `UPDATE: packages/agents/src/types/message.ts:34` - `MessageSource` gains `'command' | 'notice'` (decision 7).
- `UPDATE: packages/agents/src/types/event.ts` - `command.started { name; args }`, `command.finished { name; output? }` (decision 8).
- `UPDATE: packages/agents/src/types/agent.ts` - `AgentDefinition.slashCommands?: SlashCommand[]`; `Agent.slashCommands: readonly SlashCommand[]` (decision 3).
- `UPDATE: packages/agents/src/types/capability.ts:18-30` - `slashCommands?(args: CapabilityArgs): SlashCommand[] | Promise<SlashCommand[]>` (decision 3).
- `UPDATE: packages/agents/src/types/run.ts` - delete `CompactArgs` (decision 4).
- `UPDATE: packages/agents/src/types/contracts.test-d.ts` - a `SlashCommand` without `run` fails; a `MessageSource` of `'command'` is accepted.
- `UPDATE: packages/agents/src/index.ts` - export the three types.

## Steps

1. Write `types/slash-command.ts` per decision 2; `name` documented as `/^[a-z][a-z0-9_-]{0,63}$/`.
2. Add the two sources, the two events, the two fields, the capability method.
3. Delete `CompactArgs`; `run.ts` refers to it until task 02 removes `compact()`, so the typecheck is red between the two tasks.
4. Type tests.

## Validation

- `npx tsc -p packages/agents/tsconfig.test.json --noEmit` after task 02.
- The `contracts.test-d.ts` cases above.

## Resume

