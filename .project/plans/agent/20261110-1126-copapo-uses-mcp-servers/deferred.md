---
title: copapo uses MCP servers - deferred
date: 2026-11-10
---

These were left out of the first MCP client on purpose.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| OAuth sign-in for an HTTP server | a browser flow and stored tokens; headers and `${VAR}` cover a bearer token now | unplanned |
| The SSE transport | the MCP spec deprecated it; `copapo acp` declares `sse: false` | unplanned |
| MCP prompts as `/` commands | Claude Code lists them; the brief `copapo-loads-the-folder-it-trusts` named it as open | unplanned |
| A `/mcp` command with each server's state | `McpClients.status()` has the data; the screen shows only failures on its warning line | unplanned |
| ahpd's copapo preset comment says copapo ignores `mcpServers` | the preset is ahpd's | ahpd, `packages/agent-acp/src/presets.ts` |
