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
| [02 - Deferred tools: an index in the prompt, a definition on demand](agent/02-deferred-tools.md) | High | Not started | 01 (p3) | the MCP client |

Next free number in `agent`: `03`.

## cli

Reference: [00-cli.md](cli/00-cli.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - papo: the harness in a terminal](cli/01-papo.md) | High | Built (manual run against a model server pending) | agent/01 (p3), textui `@textui/chat` | the `facio` program |

Next free number in `cli`: `02`.

## tools

Reference: none yet (this plan is the domain's first).

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - @facio/tools: the tools every agent gets](tools/01-standard-tools.md) | High | Not started | agent/01 (p3), cli/01 | a useful papo |

Next free number in `tools`: `02`.

## Later domains (no plans yet)

`model` · `store` · `memory` · `transport` · `network` · `testing` · `documentation`.
Candidates already named in the parent plan's *Out of scope* list: code mode, guardrail package, subagent tool, network, SQLite and Durable Object stores (pluggable behind the `Store` contract; file store ships first in p3), JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`.
