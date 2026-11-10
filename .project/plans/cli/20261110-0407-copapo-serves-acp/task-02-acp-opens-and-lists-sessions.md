---
title: copapo acp opens and lists sessions
status: implemented
depends: []
layer: "copapo"
refs:
  - "[code://packages/mcp/src/stdio.ts#L24-L80](../../../../packages/mcp/src/stdio.ts#L24-L80) - the framing and the JSON-RPC error codes to copy"
  - "[code://packages/copapo/src/commands.ts#L120-L136](../../../../packages/copapo/src/commands.ts#L120-L136) - `openPapo`, which `chatFor(cwd)` builds on"
  - "[code://packages/copapo/src/commands.ts#L526-L538](../../../../packages/copapo/src/commands.ts#L526-L538) - the `chat` command"
---

## Objective

`copapo acp` answers `initialize`, `authenticate`, `session/new`, `session/list`, `session/close` and `session/delete` on stdin and stdout, and writes nothing else to stdout.

## Files

- `CREATE: packages/copapo/src/types/acp.ts` - the ACP types copapo uses, copied from the protocol schema, and the server's options.
- `CREATE: packages/copapo/src/acp/rpc.ts` - the JSON-RPC peer: line framing, requests both ways, notifications, errors.
- `CREATE: packages/copapo/src/acp/server.ts` - `serveAcp(options)`: `initialize` and the session methods, one `Chat` per `cwd`.
- `CREATE: packages/copapo/src/acp/rpc.test.ts` - framing, a split line, a bad line, an unknown method, a request to the client.
- `CREATE: packages/copapo/src/acp/server.test.ts` - the methods of this task over a pair of streams.
- `UPDATE: packages/copapo/src/commands.ts` - the `acp` command, which hands the opened copapo to `serveAcp` and resolves when stdin ends.
- `UPDATE: packages/copapo/src/index.ts` - export `serveAcp`.

## Steps

1. Copy the request and answer shapes this plan uses from the schema into `types/acp.ts`.
2. Write the peer with the line framing and the error codes of `@cofold/mcp/stdio`.
3. Let the peer send a request and resolve it when the answer with the same id arrives.
4. Answer `initialize` with protocol version 1, `agentInfo` and the capabilities, and no auth method.
5. Answer `authenticate` with `{}`.
6. Build `chatFor(cwd)` on what `openCopapo` does, and keep one `Chat` per `cwd`.
7. Answer `session/new` with the new session id, its modes and its config options.
8. Answer `session/list` from `Chat.sessions` of the `cwd`, or of `--workspace` without a `cwd`.
9. Answer `session/close` by cancelling a running turn and dropping the session's state.
10. Answer `session/delete` with `Chat.remove`.
11. Add the `acp` command, and close every `Chat` when stdin ends.

## Validation

- `rpc.test.ts`: two messages in one chunk, one message in two chunks, invalid JSON gives `-32700`, an unknown method gives `-32601`.
- `server.test.ts`: `initialize` gives version 1 and the session capabilities; `session/new` then `session/list` lists the session; `session/delete` removes it.
- `pnpm --filter @cofold/copapo test` is green.

## Resume
Implemented 2026-11-10. `acp/rpc.ts` is the peer, `acp/server.ts` the methods, `types/acp.ts` the protocol types.
`rpc.test.ts` has 5 tests. The built binary answered `initialize`, `session/new`, `session/list` and a prompt over stdio, with only JSON on stdout and exit 0 when stdin closed.
