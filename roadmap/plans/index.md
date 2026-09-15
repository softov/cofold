# Plans index

Master index of development plans.
One row per plan; children of a split plan are listed under their parent.

Status markers: `Not started` · `In progress` · `Blocked` · `Partial` · `Shipped`.

## repo

Reference: none yet (this plan is the domain's first).

| Plan | Priority | Status | Depends on | Unblocks |
| --- | --- | --- | --- | --- |
| [01 - One workspace](repo/01-workspace.md) | High | In progress (Task 1 done) | - | agent/01-p5, cli/01 |

## commands

Reference: [00-commands.md](commands/00-commands.md)

No plans yet; the framework's open items live in [`/ROADMAP.md`](../../ROADMAP.md) until one is planned.

## agent

Reference: [00-agent.md](agent/00-agent.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - Harness core](agent/01-harness-core.md) (parent) | High | In progress | - | everything |
| [01-p1 - Contracts, fake model, chat-completions adapter](agent/01-harness-core-p1-contracts.md) | High | Shipped | - | 01-p2 |
| [01-p2 - Serial loop and run handle](agent/01-harness-core-p2-loop.md) | High | Shipped | 01-p1 | 01-p3 |
| [01-p3 - Durable sessions and paused approvals](agent/01-harness-core-p3-durable-hitl.md) | High | Shipped | 01-p2 | 01-p4 |
| [01-p4 - ahpd adapter](agent/01-harness-core-p4-ahpd-adapter.md) | High | Not started | 01-p3 | - |
| [01-p5 - Steering, hook stop, thinking levels, streaming, context, usage](agent/01-harness-core-p5-streaming-context-usage.md) | Medium | Planned in part | 01-p3 | - |

Next free number in `agent`: `02`.

## cli

Reference: [00-cli.md](cli/00-cli.md)

| Plan | Priority | Status | Requires | Blocks |
| --- | --- | --- | --- | --- |
| [01 - @facio/chat: the harness in a terminal](cli/01-facio-chat.md) | High | Not started (textui CHAT-01 built) | 01-p3, textui `@textui/chat` | facio CLI |

Next free number in `cli`: `02`.

## Later domains (no plans yet)

`model` · `store` · `tools` · `memory` · `transport` · `network` · `testing` · `documentation`.
Candidates already named in the parent plan's *Out of scope* list: code mode, guardrail package, subagent tool, network, SQLite and Durable Object stores (pluggable behind the `Store` contract; file store ships first in p3), JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`.
