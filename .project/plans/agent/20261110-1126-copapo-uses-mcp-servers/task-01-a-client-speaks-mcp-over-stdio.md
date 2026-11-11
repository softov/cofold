---
title: A client speaks MCP over stdio
status: implemented
depends: []
layer: "mcp-client"
refs:
  - "[code://packages/mcp/src/stdio.ts](../../../../packages/mcp/src/stdio.ts) - the newline-delimited JSON-RPC framing to copy"
  - "[code://packages/tools/package.json](../../../../packages/tools/package.json) - the package manifest to copy"
  - "[code://.github/workflows/release.yml#L21](../../../../.github/workflows/release.yml#L21) - `PUBLISHED`"
---

## Objective

`@cofold/mcp-client` exists, with no runtime dependency beyond `@cofold/agents`.
`connectMcp(server)` starts a stdio server, initializes it, lists its tools page by page, calls a tool, and follows `list_changed`.

## Files

- `CREATE: packages/mcp-client/package.json` - `@cofold/mcp-client` 0.1.0, ESM, `files`, `engines`, the same fields as `@cofold/tools`.
- `CREATE: packages/mcp-client/tsconfig.json` - as `@cofold/tools`.
- `CREATE: packages/mcp-client/tsconfig.test.json` - as `@cofold/tools`.
- `CREATE: packages/mcp-client/src/types.ts` - `McpServerConfig` (stdio and http), `McpTool`, `McpConnection`, `Transport`.
- `CREATE: packages/mcp-client/src/rpc.ts` - a JSON-RPC client over a `Transport`: requests with ids, notifications, `ping` answered, other server requests refused with method not found.
- `CREATE: packages/mcp-client/src/stdio.ts` - the stdio transport: spawn, newline-delimited JSON, stderr lines to `warn`, close on exit.
- `CREATE: packages/mcp-client/src/connect.ts` - `connectMcp`: `initialize`, `notifications/initialized`, `tools/list` with `nextCursor`, `tools/call`, `notifications/cancelled`, `list_changed`.
- `CREATE: packages/mcp-client/src/index.ts` - the exports.
- `CREATE: packages/mcp-client/src/connect.test.ts` - against `@cofold/mcp`'s `serveStdio` in a child process.
- `CREATE: packages/mcp-client/README.md` - what the package does, the config shape, an example.
- `UPDATE: .github/workflows/release.yml:21` - `mcp-client` after `tools` in `PUBLISHED`.
- `CREATE: .project/pending/mcp-client-first-publish.md` - the by-hand first publish through softx, then `npm trust github`.

## Steps

1. Copy `@cofold/tools`'s manifest and tsconfigs, and name the package `@cofold/mcp-client`.
2. Write the JSON-RPC client with a request timeout and an abort signal per request.
3. Answer `ping` with an empty result, and refuse any other server request with -32601.
4. Write the stdio transport with `spawn`, `stdio: ['pipe', 'pipe', 'pipe']`, and the server's `env` over `process.env`.
5. On Windows, resolve a command without an extension through `PATHEXT`.
6. Send `initialize` with protocol version `2025-11-25`, empty capabilities and `clientInfo`.
7. Accept any protocol version the server answers from the list `@cofold/mcp` keeps, and fail on another.
8. List tools until `nextCursor` is absent, and list again on `notifications/tools/list_changed`.
9. On an aborted call, send `notifications/cancelled` with the request id.
10. Close by ending stdin, then kill the process after two seconds.

## Validation

- `packages/mcp-client/src/connect.test.ts`: initialize, list, call, an `isError` result, a cancel, `list_changed`, a server that exits.
- `pnpm --filter @cofold/mcp-client typecheck` passes.

## Resume

Implemented 2026-11-10. Departed from the plan: a server's stderr is not sent to `warn` line by line, which would flood the screen's warning line. The last 20 lines are kept, and a failure quotes the last three. `@cofold/agents` is a peer dependency, as in `@cofold/tools`. The first publish waits on Softov: `.project/pending/mcp-client-first-publish.md`.
