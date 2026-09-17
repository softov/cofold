---
title: papo on the Claude Agent SDK - deferred
date: 2026-09-16
---

Left out on purpose; each has a home.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| streaming (`includePartialMessages`) | the harness has no `model.delta` yet; both backends should land text the same way | [agent/01-p5 task 05](../../agent/01-harness-core-p5-streaming-context-usage/task-05-streaming.md) |
| one `/compact` per backend (`commands()` from `supportedCommands()`) | the harness has no command concept | [agent/03 task 07](../../agent/03-slash-commands/task-07-claude-backend.md) |
| subagent transcripts | skipped in the projection; no UI for them | unplanned |
| Claude's hooks and MCP configuration from papo | the CLI reads its own settings; papo adds nothing | unplanned |
| findings F1-F8 against the harness | each is a harness or papo change to check; the table in `plan.md` says where each went | agent/01-p5 task 08 (F1, F2, F4, F6, F7); agent/04 (F3); cli/04 (F1 view, F6 papo side, F8 `always`); F8 modes in cli/04 task 04 |
