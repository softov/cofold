---
title: A connection reads skills
status: todo
depends: []
layer: "mcp-client"
refs:
  - "[code://packages/mcp-client/src/connect.ts#L10-L90](../../../../packages/mcp-client/src/connect.ts#L10-L90) - the connection"
  - "[code://packages/mcp-client/src/types.ts](../../../../packages/mcp-client/src/types.ts) - the client's types"
---

## Objective

`McpConnection` has `capabilities`, `servesSkills`, `skills()`, `skill(uri)` and `read(uri)`, for the SEP-2640 calls and `resources/read`.

## Files

- `UPDATE: packages/mcp-client/src/connect.ts:10-90` - keep `capabilities`, and add the four members.
- `UPDATE: packages/mcp-client/src/types.ts` - `McpSkillInfo` and `McpResourceContents`.
- `UPDATE: packages/mcp-client/src/index.ts` - export the new types.
- `UPDATE: packages/mcp-client/src/connect.test.ts` - the skill cases.

## Steps

1. Read the SEP-2640 page, and write the shapes of `skills/list`, `skills/get` and `resources/read` as types.
2. Keep the server's `capabilities` from `initialize` on the connection.
3. Set `servesSkills` from the `io.modelcontextprotocol/skills` extension and the `resources` capability.
4. Add `skills()`, which lists every page of `skills/list`, or answers none with no call.
5. Add `skill(uri)` for `skills/get` and `read(uri)` for `resources/read`.
6. Add cases with a fake server: list two pages, get one skill, and read one file.
7. Add a case: a server without the extension answers no skills and gets no call.

## Validation

- `connect.test.ts`: the new cases.
- `pnpm test` passes in the repository.

## Resume
