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
| findings F1-F4 against the harness | each is a harness change to check | agent/01-p5 (F1, F2, F4); agent/04-policy-rules (F3) |
