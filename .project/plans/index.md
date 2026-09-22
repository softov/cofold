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
| [01-p5 - Steering, hook stop, thinking levels, streaming, context, usage](agent/01-harness-core-p5-streaming-context-usage/plan.md) | medium | built (2026-09-16; every task done) | 01 (p3) | - |
| [02 - Deferred tools: an index in the prompt, a definition on demand](agent/02-deferred-tools/plan.md) | high | built | 01 (p3) | the MCP client |
| [03 - Slash commands: internal ones the runtime runs, external ones the client keeps](agent/03-slash-commands/plan.md) | high | planned; next: task 01 | 01-p5 task 06, cli/02, cli/03 | cli/02's internal commands move here |
| [04 - Policy rules: allow, ask or deny per tool call, recorded on the run](agent/04-policy-rules/plan.md) | high | built (2026-09-16; every task done) | 01 (p3) | papo rule lists (cli) |

Next free number in `agent`: `05`.

## cli

Reference: [00-cli.md](cli/00-cli.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - papo: the harness in a terminal](cli/01-papo/plan.md) | high | built (manual run against a model server pending) | agent/01 (p3), textui `@textui/chat` | the `facio` program |
| [02 - papo slash commands](cli/02-papo-commands/plan.md) | high | built; wrong for the internal commands, superseded by agent/03 | cli/01, tools/01, agent/01-p5 task 06 | /mcp (MCP client) |
| [03 - papo on the Claude Agent SDK](cli/03-papo-claude/plan.md) | high | built (task 04's manual run on the real CLI owed) | cli/01, cli/02 | contra-validation of the harness; eight findings logged (F1-F8) |
| [04 - papo adopts the harness: steer and queue, partial text, the model's view, stop reasons, rules](cli/04-papo-harness-adoption/plan.md) | high | built 2026-09-16 ([implemented.md](cli/04-papo-harness-adoption/implemented.md), [deferred.md](cli/04-papo-harness-adoption/deferred.md)) | cli/01, agent/01-p5, agent/04 | - |

| [05 - papo remembers what a person chooses, asks the provider before the model, marks the cursor, opens a thought on click](cli/05-papo-defaults-picker-thought/plan.md) | high | built 2026-09-16 (tasks 01-05; [implemented.md](cli/05-papo-defaults-picker-thought/implemented.md)) | cli/01, cli/04, textui (linked) | - |
| [06 - papo says what a session used, in tokens, and heads the conversation with what the session is](cli/06-papo-usage-and-session-head/plan.md) | high | built 2026-09-18 ([implemented.md](cli/06-papo-usage-and-session-head/implemented.md)) | cli/04, cli/05, textui 0.6.1 | - |

Next free number in `cli`: `07`.

## tools

Reference: none yet (this plan is the domain's first).

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - @doopx/tools: the tools every agent gets](tools/01-standard-tools/plan.md) | high | built (manual run owed) | agent/01 (p3), cli/01 | a useful papo |

Next free number in `tools`: `02`.

## Later domains (no plans yet)

`model` · `store` · `memory` · `transport` · `network` · `testing` · `documentation`.
Candidates already named in the parent plan's *Out of scope* list: code mode, guardrail package, subagent tool, network, SQLite and Durable Object stores (pluggable behind the `Store` contract; file store ships first in p3), JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`.
