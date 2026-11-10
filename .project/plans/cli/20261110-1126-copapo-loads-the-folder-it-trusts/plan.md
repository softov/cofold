---
title: copapo loads the folder it trusts
domain: cli
status: planned
priority: high
created: 2026-11-10
revalidated: 2026-11-10
refs:
  - git://a44f0bb - the last commit that holds the brief `briefs/copapo-loads-the-folder-it-trusts.md`, which this plan covers; its facts were checked at git://3551a23
  - "[code://packages/copapo/src/chat.ts#L143-L149](../../../../packages/copapo/src/chat.ts#L143-L149) - `instructions()`: the configured prompt and `<workspace>/AGENTS.md`, nothing else"
  - "[code://packages/copapo/src/chat.ts#L48-L53](../../../../packages/copapo/src/chat.ts#L48-L53) - `shippedSkills()`, the source that lists only copapo's own skills"
  - "[code://packages/copapo/src/chat.ts#L84](../../../../packages/copapo/src/chat.ts#L84) - the skill sources, in the order a name clash is settled"
  - "[code://packages/store-file/src/skills.ts#L13-L31](../../../../packages/store-file/src/skills.ts#L13-L31) - `fileSkillSource`: `<root>/skills` and `<workspace>/.agents/skills`, the workspace folder only"
  - "[code://packages/copapo/src/config.ts#L92-L94](../../../../packages/copapo/src/config.ts#L92-L94) - `loadConfig`: the nearest `.copapo.json` is read with no question"
  - "[code://packages/copapo/src/config.ts#L144-L180](../../../../packages/copapo/src/config.ts#L144-L180) - `rememberConfig`: the pattern for writing a key into the user file"
  - "[code://packages/config/src/index.ts#L117-L119](../../../../packages/config/src/index.ts#L117-L119) - `resolveConfig` finds the project file by walking up; `project: undefined` skips it"
  - "[code://packages/copapo/src/commands.ts#L126](../../../../packages/copapo/src/commands.ts#L126) - `openCopapo`, which builds the service for one workspace"
  - "[code://packages/copapo/src/screen/tui.ts#L14](../../../../packages/copapo/src/screen/tui.ts#L14) - `openScreen`, where the screen starts"
  - "[code://packages/copapo/src/acp/server.ts#L73](../../../../packages/copapo/src/acp/server.ts#L73) - `chatOf(cwd)`, where a session's folder gets its service"
  - "[code://packages/copapo/src/acp/server.ts#L202](../../../../packages/copapo/src/acp/server.ts#L202) - the form copapo already sends with `elicitation/create`"
  - "[code://packages/copapo/src/claude/chat.ts#L156](../../../../packages/copapo/src/claude/chat.ts#L156) - the claude backend's `settingSources`"
  - npm://@textui/widgets@^0.9.1 - `confirm(app.layers, options)`, the trust question on the screen
  - npm://@earendil-works/pi-coding-agent@1.3.0 - docs/security.md and docs/configuration.md: project trust, saved decisions, context files
  - https://code.claude.com/docs/en/memory - CLAUDE.md load order and `@path` imports, checked 2026-11-10
  - https://agentclientprotocol.com/protocol/session-setup - session setup, where the trust question is asked over ACP
---

## Goal

copapo reads its instructions and skills from the places other agents use, and loads a folder's own configuration only when the person trusts that folder.
`AGENTS.md`, or `CLAUDE.md` where a folder has none, loads from the workspace and every folder above it, and from the common folders `~/.agents` and `~/.cofold`.
Skills load from `~/.agents/skills` and from `.agents/skills` in the workspace and the folders above it.
A folder that holds a gated file, such as `.copapo.json` or `.agents/skills`, asks once.
The question comes on the screen or through an ACP form, and the user configuration keeps the answer.

## Reconnaissance

### Searches performed

- `rg "AGENTS.md" packages/copapo/src` - one read, in `instructions()`, of the workspace file only.
- `rg "fileSkillSource" packages` - copapo builds two sources; ahpd's cofold plugin builds its own.
- `rg "project:" packages/config/src` - `resolveConfig` reads the project file only when `project` is set.
- `rg "export function confirm" ../textui/packages/widgets/src` - textui has a modal yes or no that returns a promise.
- pi 1.3.0 `docs/security.md` - the decision order, the saved decisions in `~/.pi/agent/trust.json`, and `defaultProjectTrust`.

### Runtime path

```
copapo <command> -> openCopapo -> trustOf(workspace) -> trusted | untrusted | unasked
  unasked + screen -> confirm -> saveTrust -> openCopapo again
  unasked + acp    -> elicitation/create -> saveTrust -> chatOf(cwd)
  unasked + other  -> projectTrust setting
-> loadConfig (project layer only when trusted) -> createChat (skill sources, context files)
```

### Gaps

- copapo reads no parent folder, no common folder and no `CLAUDE.md`.
- `fileSkillSource` reads `.agents/skills` in the workspace folder only, and has no way to leave it out.
- copapo has no trust, no saved answer and no `projectTrust` setting.
- The claude backend always passes `project` in `settingSources`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| copapo loads a common folder and the project: `AGENTS.md`, `.agents` and skills | Softov, 2026-11-10: "make copapo/cofold load commons folder and project AGENTS.md, .agents and skills" | 01, 02 |
| Context files load whether or not the folder is trusted | Softov, 2026-11-10: "yes load as pi and claude" | 01 |
| A folder with no `AGENTS.md` gives its `CLAUDE.md` | Softov, 2026-11-10: "yes read claude when no agents.md" | 01 |
| `@path` lines in a context file are expanded, relative to that file, up to four levels, outside code | Softov, 2026-11-10, chose "Yes, like Claude Code" | 01 |
| The common folders are `~/.agents` and `~/.cofold`; on a skill name clash `~/.cofold` wins | Softov, 2026-11-10, chose "~/.agents and ~/.cofold" | 01, 02 |
| Context files load from the workspace and every folder above it, top down, after the common files | (defaulted: pi and Claude Code walk to the filesystem root) | 01 |
| `.agents/skills` loads from the workspace and each folder above it, up to the repository root | (defaulted: as pi; the root is the first folder that holds `.git`) | 02 |
| copapo asks at start whether to trust a folder, and saves the answer in its configuration | Softov, 2026-11-10: "ask on start to trust folder if not trusted. save onto config." | 03, 04 |
| It asks only when the folder or a folder above it holds a gated file | Softov, 2026-11-10, chose "Only if gated files exist" | 03 |
| The gated files are `.copapo.json`, `.agents/skills`, and for the claude backend `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json` | (defaulted: what each backend loads from a project) | 03, 05 |
| A yes and a no are both saved; the closest saved answer for the folder or a folder above it decides | Softov, 2026-11-10, chose "Save yes and no" | 03 |
| Answers live in the user file only, under `trusted`, as a map from folder to `true` or `false` | (defaulted: a project file can never trust itself) | 03 |
| A run that cannot ask follows `projectTrust`: `ask` (default) loads nothing, `always` loads, `never` loads nothing | (defaulted: pi's `defaultProjectTrust`) | 03 |
| `copapo trust` and `copapo trust --no` save the workspace's answer; `/trust` asks again on the screen | (defaulted: pi's `/trust`) | 03, 04 |
| `copapo acp` asks through an ACP form when the client takes forms, and follows `projectTrust` when it does not | Softov, 2026-11-10, chose "Ask via ACP form" | 04 |
| The claude backend follows copapo's trust: no `project` in `settingSources` in a folder copapo does not trust | Softov, 2026-11-10, chose "Yes, follow it" | 05 |
| Agent definitions and `/agents` move to the subagent plan | Softov, 2026-11-10, chose "With the subagent plan" | - |
| Escape on the trust question saves nothing and loads nothing for this run | (defaulted: a dismissed question is not an answer) | 04 |

## Proposed architecture

- **Data flow** - `trustOf` reads the user file's `trusted` map and `projectTrust`, and finds the gated files from the workspace up. `openCopapo` passes the result to `loadConfig` and `createChat`.
- **Event flow** - The screen and the ACP server ask before they build the service for a folder. An answer is saved, then the service is built with it.
- **State flow** - Trust is read once per service. A saved answer changes the next service, not one already built.
- **Layer responsibilities** - `@cofold/store-file`: `readContextFiles` and `fileSkillSource({ project, walk })`, with no trust · copapo: the trust decision, the question, the answer and the sources.
- **Source-of-truth files** - [`code://packages/copapo/src/trust.ts`](../../../../packages/copapo/src/trust.ts) (created by task 03), [`code://packages/store-file/src/context.ts`](../../../../packages/store-file/src/context.ts) (created by task 01).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - context files load from the tree](task-01-context-files-load-from-the-tree.md) | todo | - |
| [02 - skills load from common and tree](task-02-skills-load-from-common-and-tree.md) | todo | - |
| [03 - trust decides what loads](task-03-trust-decides-what-loads.md) | todo | 02 |
| [04 - the screen and acp ask](task-04-the-screen-and-acp-ask.md) | todo | 03 |
| [05 - claude follows trust and docs](task-05-claude-follows-trust-and-docs.md) | todo | 03 |

## Risks and tradeoffs

- Context files load in an untrusted folder, so a cloned repository's `AGENTS.md` reaches the model. This is what pi and Claude Code do, and Softov chose it. The README says so.
- Walking to the filesystem root can read an `AGENTS.md` in the home folder. That file is the person's own, so it is kept.
- A trust answer saved by the screen does not change a service another process holds. Each process reads trust when it opens a folder.
- ahpd's copapo preset refuses an untrusted folder until it sets `honoursTrust`. That is an ahpd change, written in `deferred.md` when this plan closes.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-context-files-load-from-the-tree.md](task-01-context-files-load-from-the-tree.md).
- **Open questions:** none.
- **Watch out for:** `ahpd`'s cofold plugin calls `fileSkillSource({ root })`; the new options must default to today's behaviour. The trusted map is read from the user layer through `resolveConfig(...).layers`, never from the merged values.

## Final verification checklist

- [ ] `pnpm --filter @cofold/store-file typecheck` and its tests pass.
- [ ] `pnpm --filter @cofold/copapo typecheck` and its tests pass, one suite at a time.
- [ ] By hand: copapo in a folder with a `.copapo.json` asks once, and does not ask again after a yes or a no.
- [ ] By hand: `copapo acp` under ahpd asks through the form in a folder with `.agents/skills`.
