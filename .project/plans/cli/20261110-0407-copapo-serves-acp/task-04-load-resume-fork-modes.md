---
title: Load, resume, fork, modes and commands
status: implemented
depends: [task-01-chat-forks-and-reads-context.md, task-03-a-prompt-runs-a-turn.md]
layer: "copapo"
refs:
  - "[code://packages/copapo/src/types/settings.ts](../../../../packages/copapo/src/types/settings.ts) - the permission modes and the thinking levels"
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-acp/src/session/config.ts - the categories ahpd reads
---

## Objective

`copapo acp` reopens and forks sessions, and takes the mode, the model and the thinking level from the client. It tells the client its commands, its title and every change to its settings.

## Files

- `UPDATE: packages/copapo/src/acp/server.ts` - `session/load`, `session/resume`, `session/fork`, `session/set_mode`, `session/set_config_option`.
- `CREATE: packages/copapo/src/acp/settings.ts` - the modes and the config options of a session, and a config change as a `Chat.configure` patch.
- `UPDATE: packages/copapo/src/acp/server.test.ts` - load replays, fork gives a new id, a mode change and a model change.

## Steps

1. On `session/load`, replay the snapshot as updates, with each turn's input as `user_message_chunk`, then answer.
2. On `session/resume`, open the session without a replay.
3. On `session/fork`, call `Chat.fork` and answer with the new session id.
4. Build the modes from `PERMISSION_MODES`, with the session's mode as current.
5. Build a `model` option from `Chat.models`, and a `thought_level` option from `REASONING_LEVELS`.
6. Map `session/set_mode` and `session/set_config_option` to `Chat.configure`, and answer with the options.
7. Send `current_mode_update` and `config_option_update` when the settings change by another way.
8. Send `available_commands_update` from `Chat.commands` when a session opens.
9. Send `session_info_update` with the title after a turn changes it.

## Validation

- `server.test.ts`: `session/load` of a session with two turns replays both inputs and both answers.
- `server.test.ts`: `session/fork` answers a new id that `session/list` shows.
- `server.test.ts`: `set_mode` to `bypassPermissions` runs a destructive tool without a request.
- `server.test.ts`: `set_config_option` of the model changes `Chat.settings`.
- `pnpm --filter @cofold/copapo test` is green.

## Resume
Implemented 2026-11-10, in `acp/server.ts` and `acp/settings.ts`.
A mode or option set over ACP is not written back into the configuration file.
`server.test.ts` covers load, resume, fork, close, `set_mode`, `set_config_option` and a mode changed by another front.
