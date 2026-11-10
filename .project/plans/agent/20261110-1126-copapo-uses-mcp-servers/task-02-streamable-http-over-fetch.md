---
title: Streamable HTTP over fetch
status: todo
depends: [task-01-a-client-speaks-mcp-over-stdio.md]
layer: "mcp-client"
refs:
  - https://modelcontextprotocol.io/specification/2025-11-25/basic/transports - the Streamable HTTP rules
  - "[code://packages/mcp/src/server/http.ts](../../../../packages/mcp/src/server/http.ts) - cofold's HTTP server, used as the test server"
---

## Objective

`connectMcp` reaches an HTTP server with `fetch` alone.
Each message is a POST, and the reply is JSON or an SSE stream; the session id and protocol version go on every later request.

## Files

- `CREATE: packages/mcp-client/src/http.ts` - the HTTP transport.
- `CREATE: packages/mcp-client/src/sse.ts` - a reader of `text/event-stream` into `data` events.
- `CREATE: packages/mcp-client/src/http.test.ts` - against `@cofold/mcp/server`'s HTTP handler on a local port, and against a hand-written server that answers with SSE.
- `UPDATE: packages/mcp-client/src/connect.ts` - pick the transport by `type`.
- `UPDATE: packages/mcp-client/package.json` - `@modelcontextprotocol/sdk` and `@cofold/mcp` as dev dependencies, for the tests only.

## Steps

1. POST each message with `Content-Type: application/json` and `Accept: application/json, text/event-stream`.
2. Add the configured headers to every request.
3. Keep `Mcp-Session-Id` from the `initialize` reply, and send it with `MCP-Protocol-Version` on every later request.
4. Read a JSON reply as one message, and an SSE reply as messages until the answer to the request arrives.
5. Treat a 202 with no body as the answer to a notification.
6. Handle notifications and server requests that come inside an SSE reply, as the stdio transport does.
7. On a 404 with a session id, start the session again once, then fail.
8. On close, send DELETE with the session id, and ignore a 405.
9. Do not open the GET stream; `list_changed` over HTTP arrives inside a POST reply.

## Validation

- `packages/mcp-client/src/http.test.ts`: JSON and SSE replies, the session header, a 404 restart, close.
- `pnpm --filter @cofold/mcp-client typecheck` passes.

## Resume

