---
title: copapo uses the cofold names
domain: cli
status: planned
priority: high
created: 2026-11-11
revalidated: 2026-11-11
decisions:
  - decisions/library-takes-the-config-object.md
refs:
  - git://4442550 - the last commit that holds the brief `briefs/copapo-uses-the-cofold-names.md`, which this plan covers; its facts were checked at git://7a24428
  - "[code://packages/copapo/src/config.ts#L87-L138](../../../../packages/copapo/src/config.ts#L87-L138) - `loadConfig`, `projectOf`, `userConfigPath`: the resolver name, the project file, the variables and their `COFOLD_*` fallback"
  - "[code://packages/copapo/src/config.ts#L158](../../../../packages/copapo/src/config.ts#L158) - `rememberConfig` resolves under the same name"
  - "[code://packages/copapo/src/trust.ts#L26-L34](../../../../packages/copapo/src/trust.ts#L26-L34) - `gatedFiles` looks for the project file"
  - "[code://packages/copapo/src/trust.ts#L65](../../../../packages/copapo/src/trust.ts#L65) - `trustOf` reads the user file by the resolver name"
  - "[code://packages/copapo/src/commands.ts#L93-L94](../../../../packages/copapo/src/commands.ts#L93-L94) - `COPAPO_WORKSPACE` beside `COFOLD_HOME`"
  - "[code://packages/config/src/index.ts#L63-L66](../../../../packages/config/src/index.ts#L63-L66) - `environmentNameOf`: the resolver name `cofold` gives `COFOLD_CONFIG`"
  - "[code://packages/copapo/README.md#L13-L30](../../../../packages/copapo/README.md#L13-L30) - the documented files and variables"
  - "[code://.project/plans/cli/20261110-0407-papo-becomes-copapo/plan.md](../20261110-0407-papo-becomes-copapo/plan.md) - the papo rename, whose shape this plan copies"
  - npm://@earendil-works/pi-coding-agent@1.3.0 - one name for the command, the folders and the variables
  - https://code.claude.com/docs/en/settings - one name for the command, `~/.claude` and `.claude/`
---

## Goal

A person writes and sets one name for copapo: `cofold`.
The user file, the project file and every variable carry the cofold name; the command stays `copapo`.

## Reconnaissance

### Searches performed

- `rg -n "COPAPO_[A-Z_]+|\.copapo\.json|config/copapo|name: 'copapo'" packages/copapo/src` - config, trust, commands, three errors in `chat.ts`, the trust question, `types/config.ts`, and their tests.
- `rg -n "COFOLD_" examples` - no example reads a `COFOLD_*` variable, against the comment in `loadConfig`.
- `rg -n "COFOLD_CONFIG|\.cofold\.json|config/cofold|COFOLD_BACKEND|COFOLD_WORKSPACE" packages ../ahpd/packages` - all free.
- `ls ~/.config/cofold` - a `config.json` from 2026-09-26, with `providers` and `instructions`.

### Runtime path

```
copapo -> loadConfig: resolveConfig({ name: 'cofold', project: '.cofold.json' }) + COFOLD_*
       -> trustOf: resolveConfig({ name: 'cofold' }) user file -> gatedFiles: .cofold.json
       -> GLOBALS: COFOLD_WORKSPACE, COFOLD_HOME
```

### Gaps

- No gap in behaviour: the change is names only.
- ahpd's agent-cofold and machine profile read the copapo names; `deferred.md` keeps them.

## Answers

| What | Source | Task |
| --- | --- | --- |
| copapo's files and variables use the cofold name; the command stays `copapo` | Softov, 2026-11-11, asked "What should the names be?": "All cofold" | 01, 02 |
| The old names stop working at once, with no fallback and no warning | Softov, 2026-11-11, asked what happens to the old names: "Drop them at once" | 01 |
| The resolver name is `cofold`, so the user file is `~/.config/cofold/config.json` and the variable is `COFOLD_CONFIG` | (defaulted: `@cofold/config` derives both from the name) | 01 |
| The project file is `.cofold.json` | (defaulted: the resolver's `.<name>.json` form, as `.copapo.json` was) | 01 |
| `~/.cofold`, `COFOLD_HOME` and `COFOLD_TRACE` stay | the brief: they already carry the cofold name | - |
| The binary, `AGENT_ID`, `COPAPO_APP`, the ACP `agentInfo` and the MCP `clientInfo` stay `copapo` | (defaulted: they name the program, not a person's setting) | - |
| Decision 123 holds: the library takes the object, and copapo finds its own file | [code://.project/decisions/library-takes-the-config-object.md](../../../decisions/library-takes-the-config-object.md) | - |
| ahpd moves to the new names in its own work, after a cofold release | (defaulted: as the papo rename did) | - |

## Proposed architecture

- **Data flow** - Names only. `@cofold/config` resolves under `cofold`; copapo reads `COFOLD_*` with no second prefix.
- **State flow** - The user file moves to `~/.config/cofold/config.json`; the trust answers and remembered settings start empty there unless Softov copies them.
- **Layer responsibilities** - copapo: every config name. root README: the example command. ahpd: its own work, in `deferred.md`.
- **Source-of-truth files** - [`code://packages/copapo/src/config.ts`](../../../../packages/copapo/src/config.ts), [`code://packages/copapo/src/trust.ts`](../../../../packages/copapo/src/trust.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - copapo reads the cofold names](task-01-copapo-reads-the-cofold-names.md) | todo | - |
| [02 - the docs name the cofold files](task-02-the-docs-name-the-cofold-files.md) | todo | 01 |

## Risks and tradeoffs

- A person on copapo 0.1.0 loses the config, trust answers and settings until they move the file - accepted by Softov.
- Softov's `~/.config/cofold/config.json` from 2026-09-26 becomes copapo's user file - a file in `.project/pending/` asks him to merge it when task 01 is built.
- ahpd's agent-cofold reads the copapo names until ahpd changes - it reads its own files, so it keeps working; `deferred.md` says what moves.
- `COFOLD_MODEL` is already read as a fallback; after the change it is the only name - the config tests cover it.

## Resume state

- **Done so far:** the plan, 2026-11-11.
- **Next action:** [task-01-copapo-reads-the-cofold-names.md](task-01-copapo-reads-the-cofold-names.md).
- **Open questions:** none.
- **Watch out for:** keep `COPAPO_APP` and `AGENT_ID`; a blind `COPAPO_` replace renames them.

## Final verification checklist

- [ ] `rg -n "COPAPO_(CONFIG|BASE_URL|API_KEY|MODEL|BACKEND|WORKSPACE)|\.copapo\.json|config/copapo" packages README.md` finds nothing.
- [ ] `pnpm --filter @cofold/copapo typecheck` and its tests pass, one suite at a time.
- [ ] By hand: `COFOLD_BASE_URL=... copapo` starts with no file, and `copapo trust` writes to `~/.config/cofold/config.json`.
