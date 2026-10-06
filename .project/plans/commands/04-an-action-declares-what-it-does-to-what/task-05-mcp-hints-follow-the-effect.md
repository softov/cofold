---
title: MCP hints follow the effect
status: todo
depends: [task-01-the-declaration-says-what-it-does-to-what.md]
layer: "mcp"
refs:
  - "[code://packages/mcp/src/index.ts#L85-L115](../../../../packages/mcp/src/index.ts#L85-L115) - `tools`; line 105 sends `meta.mcp.annotations` unchanged"
  - "[code://packages/mcp/src/types/binding.ts](../../../../packages/mcp/src/types/binding.ts) - the annotation keys"
  - "[code://packages/mcp/src/index.test.ts#L37](../../../../packages/mcp/src/index.test.ts#L37) - the `the MCP surface` cases"
  - "[code://packages/mcp/src/stdio.test.ts#L62-L100](../../../../packages/mcp/src/stdio.test.ts#L62-L100) - annotations as `tools/list` sends them over stdio"
  - https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations - the hints and their defaults
---

## Objective

A tool's annotations are the hints derived from its command's effect with `meta.mcp.annotations` spread over them, so a key the command sets by hand wins; a command with no effect and no annotations sends none, as today.

## Files

- `UPDATE: packages/mcp/src/index.ts:105` - `annotations: annotationsFor(command)`, a function beside `tools` that returns `undefined` when both sources are empty.
- `UPDATE: packages/mcp/src/index.test.ts` - the cases below.

## Steps

1. Tests first.
2. `annotationsFor`: `read` gives `readOnlyHint: true`; `remove` gives `readOnlyHint: false, destructiveHint: true`; `add` gives `readOnlyHint: false, destructiveHint: false`; `change` gives `readOnlyHint: false` and no `destructiveHint`; then `{ ...derived, ...command.meta?.mcp?.annotations }`.

## Validation

- `effect: "read"` lists `{ readOnlyHint: true }`; fails first.
- `effect: "remove"` lists `destructiveHint: true`; fails first.
- `effect: "add"` lists `destructiveHint: false`; `effect: "change"` lists `readOnlyHint: false` and no `destructiveHint`.
- `effect: "remove"` with `meta.mcp.annotations: { destructiveHint: false }` lists `destructiveHint: false` and keeps the derived `readOnlyHint`.
- No effect and no annotations: no `annotations` key; the existing stdio and server annotation tests pass unchanged.
- `pnpm --filter @cofold/mcp test` is clean.

## Resume
