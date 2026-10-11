---
title: Slash commands - deferred
date: 2026-10-11
---

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd maps the `command`, `notice` and `skill` sources, and the `command.started` and `command.finished` events | ahpd shows the sources as user text until then, and its typecheck fails at `packages/agent-cofold/src/mapping.ts:718`, the exhaustive event switch | an ahpd plan after the `@cofold/agents` 0.2.2 release |
| A slash line sent through `handle.steer` | only papo's `say` queues it; the harness steers text | unplanned |
| `/rename` | the store has no title | unplanned |
| `/mcp` and MCP prompts as prompt commands | the MCP client | the MCP client plan |
| Claude's commands beyond listing them | the CLI runs them | unplanned |
| `/model` with no argument as a picker | Claude opens one, and papo writes a notice | after this plan |
| A resumed turn keeps its `skill` message out of an auto-compact | `resume()` does not restore `skillMessageId`; the skill is folded into the summary, and the message stays in the store | unplanned |
