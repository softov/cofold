---
title: Plans index
---

# Plans index

One row per plan; a plan is a folder with `plan.md` and one file per task.
Status: `draft` · `planned` · `active` · `built` · `dropped` (a task: `todo` · `doing` · `done` · `blocked` · `dropped`).
Format and rules: the `do-spec` skill in `.agents/skills/do-spec/`.

## commands

Reference: [00-commands.md](commands/00-commands.md)

No open plan.
Next free number in `commands`: `02`. The framework's open items live in [`/ROADMAP.md`](../../ROADMAP.md) until one is planned.

## agent

Reference: [00-agent.md](agent/00-agent.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Harness core](agent/01-harness-core/plan.md) (parent) | high | active (p1-p3 built) | - | everything |
| [01-p5 - Steering, hook stop, thinking levels, streaming, context, usage](agent/01-harness-core-p5-streaming-context-usage/plan.md) | medium | planned (task 06 done) | 01 (p3) | - |
| [02 - Deferred tools: an index in the prompt, a definition on demand](agent/02-deferred-tools/plan.md) | high | built | 01 (p3) | the MCP client |
| [03 - Slash commands: internal ones the runtime runs, external ones the client keeps](agent/03-slash-commands/plan.md) | high | planned; next: task 01 | 01-p5 task 06, cli/02, cli/03 | cli/02's internal commands move here |

Next free number in `agent`: `04`.

## cli

Reference: [00-cli.md](cli/00-cli.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - papo: the harness in a terminal](cli/01-papo/plan.md) | high | built (manual run against a model server pending) | agent/01 (p3), textui `@textui/chat` | the `facio` program |
| [02 - papo slash commands](cli/02-papo-commands/plan.md) | high | built; wrong for the internal commands, superseded by agent/03 | cli/01, tools/01, agent/01-p5 task 06 | /mcp (MCP client) |
| [03 - papo on the Claude Agent SDK](cli/03-papo-claude/plan.md) | high | built | cli/01, cli/02 | contra-validation of the harness; five findings logged |

Next free number in `cli`: `04`.

## tools

Reference: none yet (this plan is the domain's first).

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - @facio/tools: the tools every agent gets](tools/01-standard-tools/plan.md) | high | built (manual run owed) | agent/01 (p3), cli/01 | a useful papo |

Next free number in `tools`: `02`.

## Later domains (no plans yet)

`model` · `store` · `memory` · `transport` · `network` · `testing` · `documentation`.
Candidates already named in the parent plan's *Out of scope* list: code mode, guardrail package, subagent tool, network, SQLite and Durable Object stores (pluggable behind the `Store` contract; file store ships first in p3), JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`.
