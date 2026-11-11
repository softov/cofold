---
title: ACP sessions bring their servers
status: implemented
depends: [task-04-copapo-connects-its-servers.md]
layer: "copapo acp"
refs:
  - "[code://packages/copapo/src/acp/server.ts#L275-L290](../../../../packages/copapo/src/acp/server.ts#L275-L290) - `initialize`"
  - "[code://packages/copapo/src/acp/server.ts#L292-L330](../../../../packages/copapo/src/acp/server.ts#L292-L330) - the session handlers that receive `mcpServers`"
  - https://agentclientprotocol.com/protocol/session-setup - the stdio and HTTP server shapes
---

## Objective

`copapo acp` declares `mcpCapabilities: { http: true, sse: false }`.
The servers a client sends with `session/new`, `load`, `resume` or `fork` join that session's turns, beside the configured ones.

## Files

- `UPDATE: packages/copapo/src/acp/server.ts:275-290` - `mcpCapabilities` in `agentCapabilities`.
- `UPDATE: packages/copapo/src/acp/server.ts:292-330` - each handler turns `mcpServers` into copapo's shape and gives them to the session.
- `UPDATE: packages/copapo/src/types/chat.ts` - `Chat.useServers(sessionId, servers)`.
- `UPDATE: packages/copapo/src/chat.ts` - a session's servers in their own clients, closed with the session or the service.
- `UPDATE: packages/copapo/src/claude/chat.ts` - a session's servers join its query's `mcpServers`.
- `UPDATE: packages/copapo/src/acp/server.test.ts` - a stdio server sent with `session/new` serves a tool call in that session's turn.
- `UPDATE: packages/copapo/src/acp/contract.test.ts` - `initialize` and a session with `mcpServers` pass the schema.
- `CREATE: .project/plans/agent/20261110-1126-copapo-uses-mcp-servers/deferred.md` - OAuth, SSE, MCP prompts, `/mcp`, and ahpd's preset comment.

## Steps

1. Map an ACP stdio server's `env` list and an HTTP server's `headers` list to maps.
2. Skip an `sse` server with a warning, since `sse` is `false`.
3. Let a session's server replace a configured one of the same name for that session.
4. Keep a session's servers for the life of the process, and close them with `session/delete` and `close`.
5. Write `deferred.md` with each item set aside and where it goes.

## Validation

- `packages/copapo/src/acp/server.test.ts` and `contract.test.ts`: the cases in *Files*.
- `pnpm --filter @cofold/copapo typecheck` passes.
- By hand: a copapo session under ahpd lists ahpd's host tools.

## Resume

Implemented 2026-11-10. On the claude backend, a live CLI process keeps the servers it started with; the session's next process gets a new list.
