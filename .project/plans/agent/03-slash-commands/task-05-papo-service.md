---
title: papo's Chat lists the runtime's commands and declares its own
status: done
depends: [task-02-the-harness-runs-a-command.md, task-03-the-harness-expands-a-skill.md]
layer: papo
refs:
  - "[code://packages/papo/src/agent.ts#L41-L73](../../../../packages/papo/src/agent.ts#L41-L73) - `buildAgent`"
  - "[code://packages/papo/src/chat.ts#L436-L478](../../../../packages/papo/src/chat.ts#L436-L478) - `say` and `compact`"
  - "[code://packages/papo/src/types/chat.ts#L143-L185](../../../../packages/papo/src/types/chat.ts#L143-L185) - `skills()` and `compact()` on `Chat`"
  - "[code://packages/papo/src/turns.ts#L88-L95](../../../../packages/papo/src/turns.ts#L88-L95) - how an input message becomes a turn"
---

## Objective

papo declares its runtime commands, `Chat.commands()` lists the runtime's commands and prompt commands, and a slash line typed during a turn waits in the queue.

## Files

- `UPDATE: packages/papo/src/agent.ts:41-73` - `AgentArgs.commands`, passed to `createAgent` as `slashCommands`.
- `CREATE: packages/papo/src/commands/runtime.ts` - papo's runtime commands, each a closure over its store and settings.
- `UPDATE: packages/papo/src/chat.ts:436-478` - queue a slash line while a turn runs; `commands()`; remove `compact()`.
- `UPDATE: packages/papo/src/types/chat.ts:143-185` - `commands(): Promise<SlashCommandInfo[]>`; remove `compact()`.
- `UPDATE: packages/papo/src/turns.ts:88-95` - a `command` message starts a turn; `notice` and `skill` messages are parts of it.
- `UPDATE: packages/papo/src/chat.test.ts` - the cases under Validation.

## Steps

1. Write `status`, `usage`, `config`, `skills`, `context`, `model`, `reasoning`, `permissions` and `autocompact` in `commands/runtime.ts`.
2. Make `status` show the session, model, mode, reasoning, rules, workspace, home and tokens.
3. Make `usage` use `sessionUsage`, as `Chat.usage()` does.
4. Make each setter with no argument return the current value and the choices; with one, write the settings record.
5. Pass the commands to `buildAgent` through `AgentArgs.commands`.
6. Write `commands()` as `listSlashCommands` then `listPromptCommands`, with an agent that needs no model call.
7. In `say`, put a line that starts with `/` in the queue when a turn runs, as decision 5 says.
8. Remove `Chat.compact()`; `say('/compact')` does it.
9. In `turns.ts`, make a `command` message the turn's input.
10. Make a `notice` message a notice part, and a `skill` message one collapsed line.

## Validation

- `chat.test.ts`: `say('/status')` writes a notice with the model and the mode.
- `chat.test.ts`: `say('/model x')` changes the setting the chips read.
- `chat.test.ts`: `say('/compact')` during a turn waits in the queue and runs after it.
- `chat.test.ts`: `commands()` lists `compact`, `status` and each skill.
- `pnpm --filter @cofold/papo test` passes.

## Resume

- Implemented on `build/agents/a03`, awaiting review.
- The screen view is `viewOf` in `turns.ts`. It keeps the command and notice messages that `contextOf` drops. It puts a `/compact` line and its notice around the summary, so the compaction is the `/compact` turn.
- A `skill` message is a notice part `Skill: <name>`.
- `renderUsage` and `redactedConfig` moved to `commands/runtime.ts`, so that `chat.ts` does not import `commands.ts`.
- To keep this commit green, the callers of `compact()` now send `/compact`. They are the screen controller, the shell `compact` action, the contract test, and the Claude backend. The Claude backend got `commands()`. Tasks 06, 07 and 08 finish these.
