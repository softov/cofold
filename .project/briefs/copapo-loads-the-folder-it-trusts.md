---
title: copapo loads the folder it trusts
created: 2026-11-10
refs:
  - git://3551a23 - the commit of cofold the facts were checked at
  - "[code://packages/copapo/src/chat.ts#L137-L143](../../packages/copapo/src/chat.ts#L137-L143) - instructions(): the configured prompt and `<workspace>/AGENTS.md`, nothing else"
  - "[code://packages/copapo/src/chat.ts#L78](../../packages/copapo/src/chat.ts#L78) - the skill sources: copapo's home, then the shipped skills"
  - "[code://packages/store-file/src/skills.ts#L13-L31](../../packages/store-file/src/skills.ts#L13-L31) - fileSkillSource: `<root>/skills` and `<workspace>/.agents/skills`, the workspace folder only"
  - "[code://packages/copapo/src/config.ts#L94](../../packages/copapo/src/config.ts#L94) - loadConfig: the nearest `.copapo.json` is read with no question"
  - "[code://packages/config/src/index.ts#L117-L119](../../packages/config/src/index.ts#L117-L119) - the project file is found by walking up from the workspace"
  - "file:///github/ahpd/.project/briefs/agent-settings-at-plugin-and-record.md - at ahpd 8ba783e1c, line 103: Softov, 2026-11-05, \"cofold need the same level Trust as pi\"; ahpd's cofold loads no project files"
  - "file:///github/ahpd/packages/agent-acp/src/session/opening.ts - at ahpd 3512e3888, line 392: an ACP agent in a folder the host does not trust is refused unless its preset sets `honoursTrust`"
  - "npm://@earendil-works/pi-coding-agent@1.3.0 - pi's docs/configuration.md, docs/security.md and docs/skills.md: context files, project trust, skill locations"
  - "https://code.claude.com/docs/en/memory - CLAUDE.md and AGENTS.md: locations, load order, `@path` imports, checked 2026-11-10"
  - https://code.claude.com/docs/en/sub-agents - subagents in `.claude/agents/` and `~/.claude/agents/`, `--agent`, checked 2026-11-10
  - https://code.claude.com/docs/en/security - the workspace trust dialog, checked 2026-11-10
  - https://opencode.ai/docs/agents/ - OpenCode agent definitions and `mode`, checked 2026-11-10
  - https://code.claude.com/docs/en/mcp - MCP prompts listed as `/` commands, checked 2026-11-10
---

# copapo loads the folder it trusts

Softov asked on 2026-11-10 for copapo and cofold to load a common folder and the project's own files: `AGENTS.md`, `.agents` and skills.
copapo asks at start whether to trust a folder it does not trust yet, and saves the answer in its configuration.
Skills are `/` commands, and `/agents` opens a menu to pick an agent for the conversation.
He wants `AGENTS.md` support like Claude's, and notes that pi does the same.
This brief comes after the two MCP briefs: trust also decides whether a project's MCP servers start.

## What others do

- **pi 1.3.0** has an agent folder, `~/.pi/agent`, and a project folder, `.pi`.
  - Context files (`AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`) load from the agent folder, the working directory and each parent directory. They load whether or not the project is trusted.
  - Skills load from `~/.pi/agent/skills`, `.pi/skills`, and the Agent Skills locations `~/.agents/skills` and `.agents/skills`. Project `.agents/skills` folders are found from the working directory up to the repository root.
  - Project trust gates `.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, the system prompt files, and project `.agents/skills`. A bare `.pi` folder asks nothing.
  - A command-line `--approve` or `--no-approve` decides first, then an extension, then a saved decision for the folder or its closest parent.
  - With none of them, `defaultProjectTrust` decides: `ask`, `always` or `never`, with `ask` the default.
  - Saved decisions live in `~/.pi/agent/trust.json`. `/trust` saves one. Print, JSON and RPC modes cannot ask, so `ask` loads nothing there.
  - pi has no subagents.
- **Claude Code** loads `~/.claude/CLAUDE.md`, then `CLAUDE.md` and `CLAUDE.local.md` from the root down to the working directory, all of them, in that order. A subfolder's file loads when Claude first touches a file there.
  - It reads `AGENTS.md` and `.claude/AGENTS.md` in place of `CLAUDE.md` when the project has no `CLAUDE.md`. It never reads anything under `.agents/`.
  - `@path` imports expand, relative to the importing file, up to four hops.
  - It shows a trust dialog when it starts in a folder it has not trusted, and saves the answer per folder. A `-p` session shows no dialog. In the home folder, the answer is kept for the session only.
  - Subagents are Markdown files with `name`, `description`, `tools` and `model` in frontmatter, in `.claude/agents/` and `~/.claude/agents/`. The project's wins on a name clash. `claude --agent <name>` runs the whole conversation as that agent, and the `agent` setting makes it the default.
  - MCP prompts are listed in the `/` menu as `/<server>:<prompt> (MCP)`.
- **OpenCode** reads agent definitions from `.opencode/agents/`, from the working directory up to the project root, and from `~/.config/opencode/agents/`.
  - A definition is Markdown with frontmatter, and its body is the agent's prompt.
  - Its `mode` is `primary` (the session's agent), `subagent` (run through the `subagent` tool, with fresh context) or `all` (either).
- No reference reads agent definitions from `.agents/agents/`. `.agents/` is the Agent Skills folder, for skills only. Claude Code reads nothing under `.agents/`.

## What copapo has today

- copapo's system prompt is the configured `instructions` plus `<workspace>/AGENTS.md`. It reads no parent folder, no user-level file and no `@path` import.
- Skills come from `<COFOLD_HOME>/skills` (by default `~/.cofold/skills`), from `<workspace>/.agents/skills`, and from the two skills copapo ships. It does not read `~/.agents/skills`, and it reads `.agents/skills` in the workspace folder only, not in a parent.
- Skills are already `/` commands: each skill whose name fits is a prompt command, in the menu's *Skills* section.
- copapo reads the nearest `.copapo.json` above the workspace with no question. That file can set providers, their base URLs and the tool switches.
- copapo has no trust: no question, no saved answer, no setting.
- copapo has no agent definitions and no `/agents` command.
- The claude backend starts the Claude CLI with `settingSources: ['user', 'project']`. The CLI shows no trust dialog through the SDK, so the project's files load there with no question.

## What ahpd says

- ahpd's brief on agent settings quotes Softov, 2026-11-05: "cofold need the same level Trust as pi."
  That brief lists a `projectTrust` setting for ahpd's cofold plugin, at both levels, as not built. ahpd's cofold loads no project files today.
- ahpd refuses to start an ACP agent in a folder the host does not trust, unless the agent's preset sets `honoursTrust`. `honoursTrust` means the agent asks before it loads the folder's own settings. Once copapo asks, ahpd's copapo preset can set it.

## Who writes

- `main` at `3551a23` is the only line of work in cofold.
- The working tree holds an uncommitted copapo fix in `chat.ts`, `commands.ts` and the screen. This change touches `chat.ts` and the skill sources, so it starts after that fix is committed.
- The two MCP briefs touch `chat.ts` and the configuration too. This brief is built after them.
- In ahpd, the copapo preset in `packages/agent-acp/src/presets.ts` and the cofold plugin's `projectTrust` change in an ahpd change, not this one.

## The change

- cofold's library reads context files and skills from the places a host gives it.
  It loads the project's own files only when the host says the folder is trusted.
  The library never asks; the host decides.
- copapo has a common folder for every project: `~/.agents/AGENTS.md` and `~/.agents/skills`, the Agent Skills location that pi also reads.
- copapo reads `AGENTS.md` from the workspace and each parent folder up to the repository root, in order from the top down.
- In a folder with no `AGENTS.md`, copapo reads its `CLAUDE.md`, as pi does. (Softov, 2026-11-10: "yes read claude when no agents.md")
- Context files load whether or not the folder is trusted, as pi and Claude Code load them. (Softov, 2026-11-10: "yes load as pi and claude")
- copapo reads `.agents/skills` from the workspace and each parent up to the repository root.
- copapo's trust gates the project's own configuration and resources: `.copapo.json`, `.agents/skills`, and a project `.mcp.json` once the MCP client reads one.
- copapo asks at start, on its screen, when the workspace holds a gated file and no saved answer covers it. The answer is saved in the user configuration file, `~/.config/copapo/config.json`, as a list of trusted folders. A folder covers the folders under it.
- A project file can never trust itself: copapo reads the trusted list from the user file only.
- A run with no screen (`say`, `acp`, `mcp`) cannot ask. It follows a setting with three values, `ask`, `always` and `never`; `ask` loads nothing there.
- `copapo trust` and `/trust` save the workspace's answer.
- An agent definition is a Markdown file with `name`, `description`, and optional `tools` and `model`. Its body is the agent's prompt.
- copapo reads agent definitions from `.agents/agents/` and `.claude/agents/`, and from `~/.agents/agents/` and `~/.claude/agents/`. On a name clash, `.agents` wins over `.claude`, and the project wins over the user. (Softov, 2026-11-10: "Both, .agents wins")
- `/agents` opens a menu of the definitions, and the pick sets the conversation's agent.
- A main agent that hands one task to another agent is the subagent brief's work, `copapo-hands-a-task-to-a-subagent.md`. (Softov, 2026-11-10: "Its own brief")

## Open points

- Whether `@path` imports in a context file expand, as Claude Code expands them.
- Whether the common folder is `~/.agents` alone, or `~/.agents` and copapo's home (`~/.cofold`), with one winning on a name clash.
- Whether `copapo acp` asks for trust through an ACP form (`elicitation/create`), or follows the no-screen setting.
- Whether the claude backend follows copapo's trust, by leaving `project` out of `settingSources` in a folder copapo does not trust.
- Whether MCP prompts become `/` commands beside skills, as Claude Code lists them. MCP has prompts, not skills.
