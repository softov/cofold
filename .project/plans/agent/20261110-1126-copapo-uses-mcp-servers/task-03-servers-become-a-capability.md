---
title: Servers become a capability
status: todo
depends: [task-01-a-client-speaks-mcp-over-stdio.md]
layer: "mcp-client"
refs:
  - "[code://packages/agents/src/types/capability.ts#L14-L41](../../../../packages/agents/src/types/capability.ts#L14-L41) - the `Capability` this returns"
  - "[code://packages/agents/src/policy/modes.ts#L20-L28](../../../../packages/agents/src/policy/modes.ts#L20-L28) - how effects become ask or run"
  - "[code://packages/tools/src/standard.ts#L60-L67](../../../../packages/tools/src/standard.ts#L60-L67) - the capability shape to mirror"
---

## Objective

`createMcpClients({ servers, clientInfo, warn })` holds one connection per server for the process.
Its `capability()` gives every connected server's tools to an agent, deferred, named `mcp__<server>__<tool>`, with effects from their hints.

## Files

- `CREATE: packages/mcp-client/src/capability.ts` - `createMcpClients`, `capability()`, `close()`.
- `CREATE: packages/mcp-client/src/names.ts` - `toolNameOf(server, tool)`.
- `CREATE: packages/mcp-client/src/effects.ts` - `effectsOf(annotations)`.
- `CREATE: packages/mcp-client/src/expand.ts` - `${VAR}` and `${VAR:-default}` over a server config.
- `CREATE: packages/mcp-client/src/output.ts` - a `tools/call` result as tool output.
- `CREATE: packages/mcp-client/src/schema.ts` - `MCP_SERVERS_SCHEMA`, the JSON Schema of the config map.
- `CREATE: packages/mcp-client/src/capability.test.ts` - names, effects, deferral, output, errors, timeouts, a failing server, close.
- `UPDATE: packages/mcp-client/src/index.ts` - the exports.

## Steps

1. Expand `${VAR}` in `command`, `args`, `env`, `url` and `headers`, and warn once for an unset name with no default.
2. Skip a server with `enabled: false`.
3. Connect a server at the first `tools()` call, and wait up to its `startupTimeoutSec`, 10 by default.
4. Warn once when a server fails, list no tools for it, and try again at the next `tools()` call.
5. Name a tool `mcp__<server>__<tool>`, with every character outside `[a-zA-Z0-9_-]` as `_`.
6. Cut a name past 64 characters to 57, and add `_` and a six-character hash of the full name.
7. Warn on two tools with one name, and keep the first.
8. Set `defer: { over: 0 }` on the capability.
9. Map hints as the plan's *Answers* say: read-only gives `reads`, else `writes`, `destructive` and `network` by their hints.
10. Call `tools/call` with the input, abort on the run's signal, and fail after `toolTimeoutSec`, 60 by default.
11. Join the text parts, a resource's text and a resource link's URI into the output.
12. Write `[image]` or `[audio]` for media, and `structuredContent` as JSON when there is no text.
13. Throw the joined text when the result has `isError`, so the model sees a tool error.
14. Close every connection on `close()`.

## Validation

- `packages/mcp-client/src/capability.test.ts`: each step, against a fake connection and against `serveStdio`.
- `pnpm --filter @cofold/mcp-client typecheck` passes.

## Resume

