---
title: copapo uses MCP servers
domain: agent
status: planned
priority: high
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/cli/20261110-1126-copapo-loads-the-folder-it-trusts/plan.md
refs:
  - git://a44f0bb - the last commit that holds the brief `briefs/copapo-uses-mcp-servers.md`, which this plan covers; its facts were checked at git://3551a23
  - "[code://packages/agents/src/types/capability.ts#L14-L41](../../../../packages/agents/src/types/capability.ts#L14-L41) - `Capability`: tools at run start, `defer`, `exclude`; MCP servers come from a separate client package"
  - "[code://packages/agents/src/policy/modes.ts#L20-L28](../../../../packages/agents/src/policy/modes.ts#L20-L28) - `askOnEffects`: writes, destructive or network asks; reads inside the workspace run"
  - "[code://packages/agents/src/tool/create-tool.ts#L5](../../../../packages/agents/src/tool/create-tool.ts#L5) - a tool name must match `^[a-zA-Z0-9_-]{1,64}$`"
  - "[code://packages/agents/src/run/tools.ts#L95-L106](../../../../packages/agents/src/run/tools.ts#L95-L106) - a thrown error becomes a tool result the model sees, with `isError`"
  - "[code://packages/tools/src/standard.ts#L60-L67](../../../../packages/tools/src/standard.ts#L60-L67) - `standardCapabilities`, the capability package this one mirrors"
  - "[code://packages/mcp/src/stdio.ts](../../../../packages/mcp/src/stdio.ts) - the stdio JSON-RPC framing with no dependency, which the client's stdio transport copies"
  - "[code://packages/copapo/src/agent.ts#L59-L66](../../../../packages/copapo/src/agent.ts#L59-L66) - the capabilities a turn's agent gets"
  - "[code://packages/copapo/src/acp/server.ts#L275-L290](../../../../packages/copapo/src/acp/server.ts#L275-L290) - `initialize`, with no `mcpCapabilities`"
  - "[code://.project/plans/agent/02-deferred-tools/plan.md#L55](../../02-deferred-tools/plan.md#L55) - answer 9: the MCP client contributes its servers with `defer: { over: 0 }`"
  - "[code://CLAUDE.md#L53](../../../../CLAUDE.md#L53) - zero third-party runtime dependencies per package"
  - "[code://.github/workflows/release.yml#L21](../../../../.github/workflows/release.yml#L21) - `PUBLISHED`, which gains `mcp-client`"
  - https://modelcontextprotocol.io/specification/2025-11-25/server/tools - `tools/list`, `tools/call`, `list_changed`, annotations
  - https://modelcontextprotocol.io/specification/2025-11-25/basic/transports - stdio and Streamable HTTP
  - https://agentclientprotocol.com/protocol/session-setup - `mcpServers` in session setup, `mcpCapabilities`
  - https://code.claude.com/docs/en/mcp - the `mcpServers` shape and `${VAR}` expansion copapo follows, checked 2026-11-10
  - npm://@earendil-works/pi-coding-agent@1.3.0 - docs/mcp.md: hints reach the permission gate; project servers load after trust
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - `Options.mcpServers`
---

## Goal

copapo's agent uses the tools of MCP servers.
The servers come from copapo's configuration, from a trusted workspace's `.mcp.json`, and from an ACP client such as ahpd.
A new package, `@cofold/mcp-client`, speaks MCP over stdio and Streamable HTTP with no dependency.
It gives the servers' tools to any cofold agent as one capability.
With it, an ahpd session that runs copapo gets ahpd's host tools and the deployment's MCP servers.

## Reconnaissance

### Searches performed

- `rg -i "mcp" packages/*/src` - `@cofold/mcp` is a server only; no client exists.
- `rg "mcpServers" ../ahpd/packages/agent-acp/src` - ahpd sends its host tools as one HTTP server, only when `mcpCapabilities.http` is `true`.
- `rg "askOnEffects" packages/agents/src` - a tool with no effects runs without asking in the default mode.
- pi 1.3.0 `docs/mcp.md` - every MCP call goes through the tool pipeline; the hints reach the permission gate.

### Runtime path

```
config.mcpServers + .mcp.json (trusted) + ACP session mcpServers
  -> createMcpClients (one connection per server, for the process) -> capability()
  -> buildAgent capabilities -> run: tools() lists mcp__<server>__<tool>, deferred
  -> the model calls one -> policy (effects from hints) -> tools/call -> result text -> the model
```

### Gaps

- No MCP client, no transport, no config key, no `mcpCapabilities`.
- MCP tool names may hold a dot and run to 128 characters; the harness takes neither.

## Answers

| What | Source | Task |
| --- | --- | --- |
| copapo's agent uses the tools of MCP servers | Softov, 2026-11-10: "cofold has no support for mcp server? so copapo could have mcp server also?", then "Both, two briefs" | 01-05 |
| The client is a new package, `@cofold/mcp-client` | Softov, 2026-11-10, chose "New @cofold/mcp-client" | 01 |
| Streamable HTTP is written by hand over `fetch`, with no dependency | Softov, 2026-11-10, chose "By hand over fetch" | 02 |
| The hints of every configured server set the tool's effects, as pi passes them to its permission gate | Softov, 2026-11-10, asked "how pi does?", then chose "Every configured server" | 03 |
| A trusted workspace's `.mcp.json` adds servers | Softov, 2026-11-10, chose "Yes, when trusted" | 04 |
| Servers' tools are deferred: `defer: { over: 0 }` | [code://.project/plans/agent/02-deferred-tools/plan.md#L55](../../02-deferred-tools/plan.md#L55) | 03 |
| A tool is named `mcp__<server>__<tool>`; other characters become `_`; a name past 64 characters is cut and ends in a short hash | (defaulted: Claude Code's form, inside the harness's pattern) | 03 |
| `readOnlyHint: true` gives `{ reads: true }`, plus `network` only when `openWorldHint` is `true`; any other tool gives `writes`, and `destructive` and `network` unless their hint is `false` | (defaulted: the spec's defaults, so a read-only tool runs without asking) | 03 |
| The config shape is Claude Code's: `{ command, args, env, cwd }` or `{ type: "http", url, headers }`, plus `enabled`, `startupTimeoutSec` (10) and `toolTimeoutSec` (60) | (defaulted: Claude Code's shape, Codex's timeouts) | 03, 04 |
| `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`; an unset name with no default is warned and kept as written | (defaulted: as Claude Code) | 03 |
| A connection lives for the process and starts at the first turn that needs it; a server that fails is warned once and tried again at the next turn | (defaulted: copapo rebuilds its agent each turn) | 03 |
| A project entry replaces a user entry of the same name; an ACP entry replaces both | (defaulted: as pi) | 04, 05 |
| The claude backend gets the same servers through `Options.mcpServers` | (defaulted: one server list for both backends) | 04 |
| `copapo acp` declares `mcpCapabilities: { http: true, sse: false }` and connects each session's servers | [code://packages/copapo/src/acp/server.ts#L275-L290](../../../../packages/copapo/src/acp/server.ts#L275-L290), the brief | 05 |
| OAuth sign-in, SSE, MCP prompts as `/` commands and a `/mcp` status command wait | (defaulted: out of this plan; `deferred.md` keeps them) | - |

## Proposed architecture

- **Data flow** - copapo merges its server lists into one map by name and hands it to `createMcpClients`. Each turn's agent gets `clients.capability()`.
- **Event flow** - `tools()` waits for each server's connection, up to its start timeout, and lists its tools. `notifications/tools/list_changed` refetches a server's list for the next turn.
- **State flow** - The clients hold the connections; the chat service holds the clients and closes them on `close()`.
- **Layer responsibilities** - `@cofold/mcp-client`: transports, JSON-RPC, the capability, names, effects, results · copapo: the lists, trust, ACP and the claude backend.
- **Source-of-truth files** - [`code://packages/mcp-client/src/capability.ts`](../../../../packages/mcp-client/src/capability.ts) (created by task 03), [`code://packages/mcp-client/src/types.ts`](../../../../packages/mcp-client/src/types.ts) (created by task 01).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a client speaks mcp over stdio](task-01-a-client-speaks-mcp-over-stdio.md) | todo | - |
| [02 - streamable http over fetch](task-02-streamable-http-over-fetch.md) | todo | 01 |
| [03 - servers become a capability](task-03-servers-become-a-capability.md) | todo | 01 |
| [04 - copapo connects its servers](task-04-copapo-connects-its-servers.md) | todo | 02, 03 |
| [05 - acp sessions bring their servers](task-05-acp-sessions-bring-their-servers.md) | todo | 04 |

## Risks and tradeoffs

- A server that claims `readOnlyHint` and writes runs unasked. Softov chose to believe configured servers, as pi does; the README says so.
- `@cofold/mcp-client` is a new npm name. Its first publish is by hand, through the softx placeholder, then `npm trust github`. A file in `.project/pending/` says so.
- On Windows a command such as `npx` is `npx.cmd`. The stdio transport resolves a bare command through `PATHEXT`.
- ahpd's copapo preset still says copapo ignores `mcpServers`. That comment changes in ahpd, written in `deferred.md`.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-client-speaks-mcp-over-stdio.md](task-01-a-client-speaks-mcp-over-stdio.md).
- **Open questions:** none.
- **Watch out for:** stdout of a stdio server carries only protocol lines; its stderr goes to `warn`. A tool call's abort sends `notifications/cancelled`.

## Final verification checklist

- [ ] `pnpm --filter @cofold/mcp-client typecheck` and its tests pass.
- [ ] `pnpm --filter @cofold/copapo typecheck` and its tests pass, one suite at a time.
- [ ] A test drives `@cofold/mcp`'s own `serveStdio` as the server, end to end.
- [ ] By hand: a session under ahpd lists ahpd's host tools.
