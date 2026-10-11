---
title: Slash commands - deferred
date: 2026-10-11
---

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd maps the `command`, `notice` and `skill` sources | ahpd shows them as user text until then | an ahpd plan after the `@cofold/agents` 0.2.2 release |
| A slash line sent through `handle.steer` | only papo's `say` queues it; the harness steers text | unplanned |
| `/rename` | the store has no title | unplanned |
| `/mcp` and MCP prompts as prompt commands | the MCP client | the MCP client plan |
| Claude's commands beyond listing them | the CLI runs them | unplanned |
| `/model` with no argument as a picker | Claude opens one, and papo writes a notice | after this plan |
