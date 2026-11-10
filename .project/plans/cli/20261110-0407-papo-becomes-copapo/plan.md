---
title: papo becomes copapo
domain: cli
status: active
priority: high
created: 2026-11-10
revalidated: 2026-11-10
refs:
  - git://b83e428 - the last commit that holds the brief `briefs/copapo-and-acp.md`, which this plan covers; its facts were checked at git://ee48196
  - "[code://packages/copapo/package.json#L2-L23](../../../../packages/copapo/package.json#L2-L23) - the package name and the binary"
  - "[code://packages/copapo/src/config.ts#L86-L128](../../../../packages/copapo/src/config.ts#L86-L128) - the config names: `papo`, `.papo.json`, `PAPO_*`"
  - "[code://packages/copapo/src/agent.ts#L9](../../../../packages/copapo/src/agent.ts#L9) - `AGENT_ID`, written on every stored session and filtered on by the session list"
  - "[code://packages/copapo/src/chat.ts#L63-L66](../../../../packages/copapo/src/chat.ts#L63-L66) - `settingsKey`, where a session's settings live in the kv"
  - "[code://packages/copapo/src/commands.ts#L86-L92](../../../../packages/copapo/src/commands.ts#L86-L92) - `GLOBALS`, with `PAPO_WORKSPACE`"
  - "[code://packages/copapo/src/export.ts#L40](../../../../packages/copapo/src/export.ts#L40) - the export file name"
  - "[code://packages/copapo/src/program.ts#L7-L20](../../../../packages/copapo/src/program.ts#L7-L20) - the program name and `VERSION`"
  - "[code://.github/workflows/release.yml#L17-L20](../../../../.github/workflows/release.yml#L17-L20) - `PUBLISHED`, which leaves papo out"
---

## Goal

The terminal program is called copapo: the package, the binary, the config files and variables, and what it stores.
`@cofold/copapo` is published with the next cofold release.

## Reconnaissance

### Searches performed

- `rg -il papo --glob '!node_modules' --glob '!dist' --glob '!.project'` - about 25 files outside `packages/papo`, listed in task 02.
- `rg -n "'papo|PAPO_|papo-|papo/" packages/copapo/src` - the names in code: `AGENT_ID`, `settingsKey`, the config resolver name, the env variables, the export file, the screen's binding paths, the registry's `papo` provider.
- `npm view @cofold/papo`, `@cofold/copapo`, `copapo` - all three are free.
- `ls ~/.cofold` - no stored sessions on this box.

### Runtime path

```
copapo -> loadConfig({ name: 'copapo', project: '.copapo.json' }) + COPAPO_* -> createChat / createClaudeChat
       -> store.sessions.create({ agentId: 'copapo' }), kv 'copapo/session/<id>/settings'
```

### Gaps

- `PUBLISHED` in the release workflow does not name the package.
- ahpd's agent-cofold reads the papo config names. It moves in its own plan, after a cofold release.

## Answers

| What | Source | Task |
| --- | --- | --- |
| papo is renamed copapo | Softov, 2026-11-09: "I think I want to rename papo to copapo" | 01 |
| The config names become copapo's, and copapo does not read the papo names | Softov, 2026-11-09, asked what happens to the config names: "Rename to copapo" | 01 |
| `@cofold/copapo` is published with the next cofold release | Softov, 2026-11-09, asked whether it is published: "Publish with next release" | 02 |
| The stored agent id and settings key become `copapo`, and papo's sessions are no longer listed | Softov, 2026-11-10, asked about the stored ids: "Rename, papo sessions hidden" | 01 |
| `COFOLD_*` variables and `~/.cofold` stay | the brief: they are the family's, not papo's | 01 |
| The files under `.project/` and `.agents/` keep the papo name | (defaulted: they are records of past work, and `.agents/` is the vendored do-spec skill) | 02 |
| The version stays `0.0.1`, and the release tag is Softov's | (defaulted: the handoff says the version and the release are Softov's) | 02 |

## Proposed architecture

- **Data flow** - Nothing changes but names. The config resolver reads `copapo` and `.copapo.json`; the env prefix is `COPAPO_`.
- **State flow** - New sessions are stored with `agentId: 'copapo'` and settings at `copapo/session/<id>/settings`.
- **Layer responsibilities** - copapo: every name. tools, agents: comments and test names only. release workflow: `copapo` in `PUBLISHED`.
- **Source-of-truth files** - [`code://packages/copapo/src/config.ts`](../../../../packages/copapo/src/config.ts), [`code://packages/copapo/src/agent.ts`](../../../../packages/copapo/src/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The package and its names are copapo](task-01-the-package-and-its-names-are-copapo.md) | implemented | - |
| [02 - The repository names copapo and publishes it](task-02-the-repository-publishes-copapo.md) | implemented | 01 |

## Risks and tradeoffs

- With trusted publishing, the first publish of a new npm name may need work by hand on npmjs.com - Softov checks it before the release tag.
- A session made by papo is not listed after the rename - accepted by Softov; the files stay on disk.

## Resume state

- **Done so far:** the plan, 2026-11-10. Tasks 01 and 02 implemented on 2026-11-10, not committed.
- **Next action:** Softov reviews tasks 01 and 02 and sets them to done. Before the release tag, Softov checks the first publish of `@cofold/copapo` on npmjs.com.
- **Watch out for:** `git mv` the folder so history follows; regenerate `pnpm-lock.yaml` with `pnpm install`, never by hand.

## Final verification checklist

- [x] `rg -i '\bpapo' packages --glob '!node_modules' --glob '!dist'` finds nothing.
- [x] `pnpm typecheck` is green; the copapo, tools and agents tests are green.
- [x] `node packages/copapo/dist/main.js --help` names `copapo`.
