---
title: copapo connects its servers
status: todo
depends: [task-02-streamable-http-over-fetch.md, task-03-servers-become-a-capability.md]
layer: "copapo"
refs:
  - "[code://packages/copapo/src/agent.ts#L59-L66](../../../../packages/copapo/src/agent.ts#L59-L66) - where the capability joins each turn's agent"
  - "[code://packages/copapo/src/config.ts](../../../../packages/copapo/src/config.ts) - the schema that gains `mcpServers`"
  - "[code://packages/copapo/src/claude/chat.ts](../../../../packages/copapo/src/claude/chat.ts) - the claude backend's query options"
---

## Objective

copapo reads `mcpServers` from its configuration and from a trusted workspace's `.mcp.json`, and every turn's agent has their tools.
The claude backend gets the same servers.

## Files

- `UPDATE: packages/copapo/package.json` - `@cofold/mcp-client` as a dependency.
- `UPDATE: packages/copapo/src/config.ts` - `mcpServers: MCP_SERVERS_SCHEMA` in the schema.
- `UPDATE: packages/copapo/src/types/config.ts` - `mcpServers` on `CopapoConfig`.
- `CREATE: packages/copapo/src/servers.ts` - `serversOf({ config, workspace, trusted })`: the config map, then `.mcp.json` when trusted.
- `UPDATE: packages/copapo/src/chat.ts` - the service builds `createMcpClients` once, passes its capability to each agent, and closes it on `close()`.
- `UPDATE: packages/copapo/src/agent.ts:59-66` - `AgentArgs.capabilities`, added after the skills.
- `UPDATE: packages/copapo/src/claude/chat.ts` - `mcpServers` in the query options, in the SDK's shape.
- `UPDATE: packages/copapo/src/chat.test.ts` - a configured stdio server's tool is called in a turn; a read-only tool runs without asking in `default`; a write asks.
- `UPDATE: packages/copapo/README.md` - the `mcpServers` key, `.mcp.json`, the trust rule, the hints rule.

## Steps

1. Add `mcpServers` to the schema, so `.copapo.json` can hold it once trusted.
2. In a trusted folder, read the `mcpServers` object of `<workspace>/.mcp.json`.
3. Let a `.mcp.json` entry replace a config entry of the same name.
4. Build the clients once per service, with `clientInfo` from copapo's name and `VERSION`.
5. Pass `warn` from the service, so a failing server shows on the screen's warning line.
6. Give the claude backend the same map, with `http` entries as `{ type: 'http', url, headers }`.

## Validation

- `packages/copapo/src/chat.test.ts`: the cases in *Files*.
- `pnpm --filter @cofold/copapo typecheck` passes.

## Resume

