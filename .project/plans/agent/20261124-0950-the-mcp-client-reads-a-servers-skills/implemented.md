---
title: The MCP client reads a server's skills - implemented
date: 2026-11-24
refs:
  - "[code://packages/mcp-client/src/connect.ts](../../../../packages/mcp-client/src/connect.ts) - `servesSkills`, `skills`, `skill`, `read`"
  - "[code://packages/mcp-client/src/types.ts](../../../../packages/mcp-client/src/types.ts) - `McpSkillInfo`, `McpSkillResource`, `McpResourceContents`"
---

A connection keeps the server's `capabilities`, says `servesSkills`, lists every page of `skills/list`, gets one skill with `skills/get`, and reads a file with `resources/read`.

## Verified

- `connect.test.ts`: two cases against `test-fixtures/skills-server.mjs`.
- `pnpm test`: 93 files, 1202 cases, no type errors. `pnpm typecheck` passes.

## Departures from the plan

- None.
