---
title: 117 - Permission rules are data the harness evaluates; a tool names its subject
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2310-L2403 - `PermissionBehavior`, `PermissionRuleValue { toolName, ruleContent? }`, `PermissionUpdate`, the destinations
  - code://packages/agents/src/types/tool.ts#L31-L53 - `ToolDefinition` / `Tool`; `subject` is the new slot
  - code://packages/tools/src/shell.ts#L40 - `shell_exec`, whose subject is the command
  - code://packages/tools/src/files.ts#L47-L153 - the file tools, whose subject is the path or the pattern
---

## Context

Claude's rules are lists of `{ toolName, ruleContent? }` per behavior (`Bash(rm *)`, `Edit(src/**)`), matched per tool: a command for Bash, a path for the file tools.
The harness had no rule shape, so every host would invent one.

## Decision

`@cofold/agents` exports `rules({ allow?, deny?, ask?, otherwise? })` returning a `Policy`, with `Rule = { tool: string; match?: string }`.
`tool` is a tool name or `*`; `match` is a glob (`*` any run of characters, `?` one, anchored to the whole subject) checked against what the tool declares as its subject.
`ToolDefinition.subject?(input) => string` is the new slot; a tool without one matches on name only.
Evaluation order: `deny`, then `ask`, then `allow`; when nothing matches, `otherwise` decides (default: the default policy, agent/04 task 01).
`@cofold/tools` declares `subject` on `shell_exec` (the command), on `read_file`, `write_file`, `edit_file` (the path) and on `list_files`, `search_files` (the pattern; those two take no path).

Source: user, 2026-09-16, asked "Harness ships rules() (Claude) / Function only".
`(defaulted: the glob dialect, two wildcards, anchored)`; reversible by a later decision.

## Consequences

A host writes `rules({ deny: [{ tool: 'shell_exec', match: 'rm *' }] })`; papo carries rule lists in its config (cli/04 task 04).
The dialect is narrower than Claude's per-tool matchers; a path under a directory is written with `*` today.

## Options

Rules in the host only ("function only") left papo, ahpd and every other host to agree on a syntax by accident.
