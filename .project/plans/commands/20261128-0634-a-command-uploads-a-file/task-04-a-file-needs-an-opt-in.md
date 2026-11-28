---
title: A file needs an opt-in on MCP
status: todo
depends: [task-01-a-file-field-is-a-path.md]
layer: "mcp, remote"
refs:
  - "[code://packages/mcp/src/index.ts#L86-L101](../../../../packages/mcp/src/index.ts#L86-L101) - `tools`, which every MCP entry point calls"
  - "[code://packages/mcp/src/types/tool.ts#L16-L22](../../../../packages/mcp/src/types/tool.ts#L16-L22) - `ToolOptions`"
  - "[code://packages/mcp/src/stdio.ts#L55](../../../../packages/mcp/src/stdio.ts#L55) - `serveStdio` passes only `filter`, here and at line 176"
  - "[code://packages/mcp/src/types/stdio.ts#L3-L28](../../../../packages/mcp/src/types/stdio.ts#L3-L28) - `StdioOptions`"
  - "[code://packages/mcp/src/server/server.ts#L54-L85](../../../../packages/mcp/src/server/server.ts#L54-L85) - the SDK server calls `tools` three times"
  - "[code://packages/mcp/src/types/server.ts#L18-L38](../../../../packages/mcp/src/types/server.ts#L18-L38) - `McpServerOptions`"
  - "[code://packages/remote/src/manifest.ts#L72-L80](../../../../packages/remote/src/manifest.ts#L72-L80) - `manifestFrom`"
  - "[code://packages/remote/src/serve.ts#L145-L152](../../../../packages/remote/src/serve.ts#L145-L152) - `routesOf`"
---

## Objective

`tools()` leaves out every command for which `hasFileInput` is true, unless `allowFiles` is `true`.
`serveStdio` and the SDK server pass `allowFiles` through, so no MCP entry point lists a file command by default.
`routesOf` and `manifestFrom` leave out a file command, so a client can never make a server read a path that the client chose.

## Files

- `UPDATE: packages/mcp/src/types/tool.ts:16-22` - add `allowFiles?: boolean` to `ToolOptions`, off by default.
- `UPDATE: packages/mcp/src/index.ts:86-101` - filter out file commands unless `options.allowFiles` is `true`.
- `UPDATE: packages/mcp/src/types/stdio.ts:3-28` - add `allowFiles?: boolean` to `StdioOptions`.
- `UPDATE: packages/mcp/src/stdio.ts:55` - pass `allowFiles` with `filter` to `tools`, here and at line 176.
- `UPDATE: packages/mcp/src/types/server.ts:18-38` - add `allowFiles?: boolean` to `McpServerOptions`.
- `UPDATE: packages/mcp/src/server/server.ts:54-85` - pass `allowFiles` in the three `tools` calls.
- `UPDATE: packages/remote/src/serve.ts:145-152` - `routesOf` skips a command for which `hasFileInput` is true.
- `UPDATE: packages/remote/src/manifest.ts:72-80` - `manifestFrom` skips the same commands.
- `UPDATE: packages/mcp/src/index.test.ts` - the `tools` cases in Validation.
- `UPDATE: packages/mcp/src/stdio.test.ts` - the `serveStdio` case in Validation.
- `UPDATE: packages/remote/src/serve.test.ts` - the `serve` case in Validation.
- `UPDATE: packages/remote/src/manifest.test.ts` - the `manifestFrom` case in Validation.

## Steps

1. Add `allowFiles` to the three option types, each with a doc comment that says what an agent can then read.
2. Filter in `tools` after `surfaceEnabled`, with `hasFileInput` from `@cofold/commands`.
3. Pass `allowFiles` from `serveStdio` and from the SDK server to every `tools` call.
4. Skip file commands in `routesOf` and in `manifestFrom`.
5. Write the tests.

## Validation

- `index.test.ts`: a registry with one file command and one text command lists one tool by default, and two with `allowFiles: true`.
- `stdio.test.ts`: `tools/list` from `serveStdio` lists the file command only with `allowFiles: true`.
- `serve.test.ts`: a file command with an `http` surface has no route; a request to its path answers 404.
- `manifest.test.ts`: `manifestFrom` leaves out a file command with an `http` surface.
- `pnpm --filter @cofold/mcp test` and `pnpm --filter @cofold/remote test` pass.

## Resume
