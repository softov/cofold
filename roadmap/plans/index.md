# Plans index

Master index of development plans.
One row per plan; children of a split plan are listed under their parent.

Status markers: `Not started` · `In progress` · `Blocked` · `Partial` · `Shipped`.

## commands

Reference: [00-commands.md](commands/00-commands.md)

No open plan.
Next free number in `commands`: `02`. The framework's open items live in [`/ROADMAP.md`](../../ROADMAP.md) until one is planned.

## agent

Reference: [00-agent.md](agent/00-agent.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Harness core](agent/01-harness-core.md) (parent) | High | In progress (p1-p3 shipped) | - | everything |
| [01-p5 - Steering, hook stop, thinking levels, streaming, context, usage](agent/01-harness-core-p5-streaming-context-usage.md) | Medium | Planned in part | 01 (p3) | - |
| [02 - Deferred tools: an index in the prompt, a definition on demand](agent/02-deferred-tools.md) | High | Built | 01 (p3) | the MCP client |
| [03 - Slash commands: internal ones the runtime runs, external ones the client keeps](agent/03-slash-commands.md) | High | Not started (open questions to lock) | 01-p5 Task 6, cli/02, cli/03 | cli/02's internal commands are moved here |

Next free number in `agent`: `04`.

## cli

Reference: [00-cli.md](cli/00-cli.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - papo: the harness in a terminal](cli/01-papo.md) | High | Built (manual run against a model server pending) | agent/01 (p3), textui `@textui/chat` | the `facio` program |
| [02 - papo slash commands](cli/02-papo-commands.md) | High | Built; wrong for the internal commands, superseded by agent/03 | cli/01, tools/01, agent/01-p5 Task 6 | /mcp (MCP client) |
| [03 - papo on the Claude Agent SDK](cli/03-papo-claude.md) | High | Built | cli/01, cli/02 | contra-validation of the harness; five findings logged |

Next free number in `cli`: `02`.

## tools

Reference: none yet (this plan is the domain's first).

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - @facio/tools: the tools every agent gets](tools/01-standard-tools.md) | High | Built (manual run owed) | agent/01 (p3), cli/01 | a useful papo |

Next free number in `tools`: `02`.

## Later domains (no plans yet)

`model` · `store` · `memory` · `transport` · `network` · `testing` · `documentation`.
Candidates already named in the parent plan's *Out of scope* list: code mode, guardrail package, subagent tool, network, SQLite and Durable Object stores (pluggable behind the `Store` contract; file store ships first in p3), JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`.
