---
title: papo's Chat lists the runtime's commands and declares its own internal ones
status: todo
depends: [task-02-registry-built-ins.md]
layer: papo
refs:
  - code://packages/papo/src/types/chat.ts
  - code://packages/papo/src/chat.ts#L88-L96
  - code://packages/papo/src/agent.ts
  - code://packages/papo/src/turns.ts#L46-L47
---

## Objective

`Chat.commands()` returns the runtime's list; `Chat.compact()` is gone; `say('/status')` on the facio backend writes a notice into the transcript; `say('/model x/y')` changes the session's setting the way `configure()` does; the projection shows a command run as input plus notice.

## Files

- `UPDATE: packages/papo/src/types/chat.ts` - `commands(): Promise<SlashCommandInfo[]>`; delete `compact()` (decision 11).
- `UPDATE: packages/papo/src/chat.ts` - `commands`; delete `compact`; papo's internal commands built here as closures over `kv`, `store`, `config`, `providers`, `workspace`, `home` and handed to `buildAgent` (decision 9): `status`, `cost`, `config`, `skills`, `context`, `model [ref]`, `reasoning [level]`, `permissions [mode]`, `autocompact [on|off]`.
- `UPDATE: packages/papo/src/agent.ts` - `AgentArgs.commands: SlashCommand[]` becomes `definition.slashCommands`.
- `UPDATE: packages/papo/src/turns.ts:46-47` - `source: 'command'` is a turn's input; `source: 'notice'` a `notice` part.
- `UPDATE: packages/papo/src/export.ts` - a notice renders as a quoted line.

## Steps

1. The setters validate with `checkSettings` and write the `kv` record `configure()` writes; the output names the new value (`model: or/qwen3`). With no argument they print the current value and the choices (decision 9; the plan's open question 3).
2. `status` prints session id, title, model, permissions, reasoning, autocompact, workspace, home, tokens so far; `cost` prints per-turn and total usage from the run records; `config` prints `redactedConfig`; `skills` prints what `listSkills` gives; `context` prints the message count, the estimated tokens, the budget.
3. `commands()` needs an agent: build it from the defaults (`agentFor(await settingsOf(undefined))`) and `listSlashCommands` it; skills stay in `skills()`.

## Validation

- `UPDATE: packages/papo/src/chat.test.ts` - `commands()` includes `compact` and `status`; `say('/compact')` after two turns gives a turn with input `/compact`, a summary part and a notice `Compacted`; `say('/model fake/other')` changes `settings().model` and leaves a notice; `say('/status')` leaves a notice with the session id.
- `pnpm check`.

## Resume

