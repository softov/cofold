---
title: copapo uses the cofold names
created: 2026-11-11
refs:
  - git://7a24428 - the commit of this repository the facts were checked at
  - git://080dc4799 - the ahpd commit the ahpd facts were checked at
  - "[code://packages/copapo/src/config.ts#L87-L138](../../packages/copapo/src/config.ts#L87-L138) - `loadConfig`, `projectOf` and `userConfigPath`: the resolver name `copapo`, `.copapo.json`, the `COPAPO_*` variables with the `COFOLD_*` fallback"
  - "[code://packages/copapo/src/config.ts#L158](../../packages/copapo/src/config.ts#L158) - `rememberConfig` resolves under the name `copapo`"
  - "[code://packages/copapo/src/trust.ts#L26-L34](../../packages/copapo/src/trust.ts#L26-L34) - `gatedFiles` looks for `.copapo.json`"
  - "[code://packages/copapo/src/trust.ts#L65](../../packages/copapo/src/trust.ts#L65) - `trustOf` reads the user file under the name `copapo`"
  - "[code://packages/copapo/src/commands.ts#L93-L94](../../packages/copapo/src/commands.ts#L93-L94) - `COPAPO_WORKSPACE` beside `COFOLD_HOME`"
  - "[code://packages/store-file/src/home.ts#L5-L9](../../packages/store-file/src/home.ts#L5-L9) - `resolveHome`: `<NAME>_HOME`, else `~/.<name>`"
  - "[code://packages/config/src/index.ts#L63-L66](../../packages/config/src/index.ts#L63-L66) - `environmentNameOf`: the resolver name gives the `<NAME>_CONFIG` variable"
  - "[code://packages/copapo/README.md#L13-L30](../../packages/copapo/README.md#L13-L30) - the documented config files and variables"
  - "[code://.project/decisions/library-takes-the-config-object.md](../decisions/library-takes-the-config-object.md) - decision 123: the library takes the object, and each program finds its own file"
  - npm://@earendil-works/pi-coding-agent@1.3.0 - docs/configuration.md and docs/mcp.md: one name, `~/.pi/agent` and `.pi/`
  - https://code.claude.com/docs/en/settings - Claude Code: one name, `~/.claude`, `.claude/` and `CLAUDE.md`
---

# copapo uses the cofold names

Softov wants one name for everything a person writes or sets for copapo: `cofold`.
Today copapo uses two names for one product, and the provider variables exist under both.
The command stays `copapo`; the files and variables become cofold's.
Old names stop working at once, with no fallback.

Source: Softov, 2026-11-11, asked "What should the names be?": "All cofold". Asked what happens to the old names: "Drop them at once".

## What others do

- pi 1.3.0 uses one name: the command `pi`, the folder `~/.pi/agent` for settings and sessions, the project folder `.pi/`, and `PI_*` variables.
- Claude Code uses one name: the command `claude`, `~/.claude`, the project folder `.claude/`, and `CLAUDE.md`.

## What cofold has today

| What | Name | Where |
| --- | --- | --- |
| Data: sessions, memory, kv, skills, `AGENTS.md` | `~/.cofold`, `COFOLD_HOME` | [`code://packages/copapo/src/commands.ts`](../../packages/copapo/src/commands.ts) line 94 |
| User file | `~/.config/copapo/config.json` | [`code://packages/copapo/src/config.ts`](../../packages/copapo/src/config.ts) line 136 |
| File named by a variable | `COPAPO_CONFIG`, from the resolver name | [`code://packages/config/src/index.ts`](../../packages/config/src/index.ts) line 64 |
| Project file | `.copapo.json` | [`code://packages/copapo/src/config.ts`](../../packages/copapo/src/config.ts) line 132 |
| Provider | `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL`, else the same `COFOLD_*` | [`code://packages/copapo/src/config.ts`](../../packages/copapo/src/config.ts) lines 108-120 |
| Runtime | `COPAPO_BACKEND` | [`code://packages/copapo/src/config.ts`](../../packages/copapo/src/config.ts) line 122 |
| Workspace | `COPAPO_WORKSPACE` | [`code://packages/copapo/src/commands.ts`](../../packages/copapo/src/commands.ts) line 93 |
| Error trace | `COFOLD_TRACE` | [`code://packages/terminal/src/entry.ts`](../../packages/terminal/src/entry.ts) line 44 |

- The comment in `loadConfig` says the examples read `COFOLD_*`; `rg COFOLD_ examples` finds none.
- `.copapo.json` and `~/.config/copapo` are written in copapo's source, tests and README, and in the user message of three errors in `chat.ts`.
- Names that are not config stay `copapo`: the binary, `AGENT_ID`, the app identity `COPAPO_APP`, the ACP `agentInfo`, the MCP `clientInfo`.
- Decision 123 holds: the library still takes the object, and copapo still finds its own file. Only the file's name changes.
- `~/.config/cofold/config.json` exists on Softov's box, dated 2026-09-26, with `providers` and `instructions`. It is from ahpd's agent-cofold before it read copapo's file. After the change copapo reads it as its user file.

## Who writes

- ahpd's agent-cofold reads copapo's config by name: `resolveConfig({ name: 'copapo', project: '.copapo.json' })`, `COPAPO_CONFIG`, and `COPAPO_*` over `COFOLD_*` (`packages/agent-cofold/src/config.ts`, lines 42-107, at git://080dc4799). It keeps working against copapo 0.1.0 until ahpd changes.
- ahpd's machine profile for copapo sets `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL` and `COPAPO_CONFIG` (`packages/sdk/src/machines/agents.ts`, lines 218-221). A machine on the new copapo needs the `COFOLD_*` names.
- ahpd's agent-cofold mounts the config at `copapo/config.json` and sets `COPAPO_CONFIG` (`packages/agent-cofold/src/agent.ts`, lines 989-1017).
- ahpd's docs name the copapo files in `docs/plugins/COMPUTERS.md`, `docs/plugins/PLUGINS.md` and `packages/agent-cofold/README.md`.
- The ahpd changes are ahpd's own work, after a cofold release, as the papo rename did.
- No other branch or session writes copapo's config files at git://7a24428.

## The change

- The resolver name is `cofold`: the user file is `~/.config/cofold/config.json`, and the variable that names a file is `COFOLD_CONFIG`.
- The project file is `.cofold.json`, in loading, trust and the trust question.
- The variables are `COFOLD_BASE_URL`, `COFOLD_API_KEY`, `COFOLD_MODEL`, `COFOLD_BACKEND` and `COFOLD_WORKSPACE`.
- copapo reads no `COPAPO_*` variable, no `.copapo.json` and no `~/.config/copapo`.
- `~/.cofold`, `COFOLD_HOME` and `COFOLD_TRACE` stay.
- The binary, `AGENT_ID`, `COPAPO_APP`, `agentInfo` and `clientInfo` stay `copapo`.
- copapo's README, the root README and the error messages use the new names.
- The trust answers saved under `trusted` in `~/.config/copapo/config.json` are not read; a trusted folder asks again.

## Open points

- Softov merges his `~/.config/copapo/config.json` into the existing `~/.config/cofold/config.json` by hand before he runs the new copapo.
