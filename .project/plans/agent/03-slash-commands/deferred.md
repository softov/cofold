---
title: Slash commands - deferred
date: 2026-09-16
---

Named in decision 15 and left out of this plan.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| steering (a message during a turn) | its own task | [agent/01-p5 task 02](../01-harness-core-p5-streaming-context-usage/task-02-steering-loop.md) |
| streaming | its own task; the next after this plan | [agent/01-p5 task 05](../01-harness-core-p5-streaming-context-usage/task-05-streaming.md) |
| `/rename` | no title in the store | unplanned |
| `/mcp` | the MCP client | the MCP client plan |
| Claude's commands beyond listing them | the CLI runs them; papo promises nothing about them | unplanned |
| `/model` with no argument as a picker (Claude opens one; ours prints) | a divergence to check once the command exists | this plan's open question 3 |
