---
title: copapo uses MCP servers
created: 2026-11-10
refs:
  - git://3551a23 - the commit of cofold the facts were checked at
  - "[code://packages/agents/src/types/capability.ts#L14-L41](../../packages/agents/src/types/capability.ts#L14-L41) - Capability: tools resolved at run start, `defer`, `exclude`; MCP servers come from a separate client package"
  - "[code://packages/agents/src/policy/modes.ts#L20-L28](../../packages/agents/src/policy/modes.ts#L20-L28) - askOnEffects: a tool with no effects runs without asking"
  - "[code://packages/agents/src/tool/create-tool.ts#L5](../../packages/agents/src/tool/create-tool.ts#L5) - a tool name must match ^[a-zA-Z0-9_-]{1,64}$"
  - "[code://packages/copapo/src/agent.ts#L43-L76](../../packages/copapo/src/agent.ts#L43-L76) - buildAgent: the agent is rebuilt every turn, its capabilities with it"
  - "[code://packages/copapo/src/chat.ts#L189](../../packages/copapo/src/chat.ts#L189) - agentWith: where each turn's agent is built"
  - "[code://packages/copapo/src/acp/server.ts#L275-L287](../../packages/copapo/src/acp/server.ts#L275-L287) - initialize: no mcpCapabilities"
  - "[code://packages/copapo/src/claude/chat.ts#L156](../../packages/copapo/src/claude/chat.ts#L156) - the claude backend reads the CLI's user and project settings"
  - "[code://.project/plans/agent/02-deferred-tools/plan.md#L55](../../.project/plans/agent/02-deferred-tools/plan.md#L55) - answer 9: the MCP client contributes its servers with defer: { over: 0 }"
  - "[code://.project/plans/cli/20261110-0407-copapo-serves-acp/deferred.md#L10](../../.project/plans/cli/20261110-0407-copapo-serves-acp/deferred.md#L10) - the client's mcpServers wait on this"
  - "[code://CLAUDE.md#L53](../../CLAUDE.md#L53) - zero third-party runtime dependencies per package; optional peers are the exception"
  - "file:///github/ahpd/packages/agent-acp/src/session/opening.ts - serversFor at ahpd 3512e3888, lines 123-185: what ahpd sends as mcpServers"
  - "file:///github/ahpd/packages/agent-acp/src/presets.ts - the copapo preset at ahpd 3512e3888, line 211: notes that copapo ignores mcpServers"
  - "https://agentclientprotocol.com/protocol/session-setup - ACP: every agent must support stdio MCP servers; http and sse are declared in mcpCapabilities, checked 2026-11-10"
  - "https://modelcontextprotocol.io/specification/2025-11-25/server/tools - MCP tools: tools/list, tools/call, list_changed, annotations untrusted unless the server is trusted"
  - "https://code.claude.com/docs/en/mcp - Claude Code: .mcp.json and ~/.claude.json, ${VAR} expansion, approval for project servers, checked 2026-11-10"
  - "https://learn.chatgpt.com/docs/extend/mcp?surface=cli - Codex: [mcp_servers.<name>] in ~/.codex/config.toml, checked 2026-11-10"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.273 - Options.mcpServers and strictMcpConfig
---

# copapo uses MCP servers

Softov asked on 2026-11-10 why cofold has no MCP support.
The goal is that copapo's agent uses the tools of MCP servers: servers from copapo's configuration, and servers an ACP client sends with a session.
With it, an ahpd session that runs copapo gets ahpd's host tools and the deployment's MCP servers, as a Claude or Codex session does.

## What others do

- **Claude Code** reads `mcpServers` from `.mcp.json` at the project root and from `~/.claude.json` for the user and local scopes.
  - A stdio entry has `command`, `args` and `env`, and no `type`. An HTTP entry has `type: "http"`, `url` and `headers`.
  - `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`.
  - Claude Code asks before it uses a project server from `.mcp.json` in an interactive session.
- **Codex** reads `[mcp_servers.<name>]` tables from `~/.codex/config.toml`, and from `.codex/config.toml` in a trusted project.
  - Keys: `command`, `args`, `env`, `cwd`, `url`, `bearer_token_env_var`, `http_headers`, `startup_timeout_sec` (10), `tool_timeout_sec` (60), `enabled`, `enabled_tools`, `disabled_tools`.
- **ACP** sends `mcpServers` in `session/new`, `session/load`, `session/resume` and `session/fork`.
  - Every agent must support a stdio server: `name`, `command`, `args`, `env` as a list of name and value.
  - An agent takes an HTTP server (`type: "http"`, `name`, `url`, `headers`) only when it declares `mcpCapabilities.http`.
- **MCP** itself: a client lists tools with `tools/list` and calls one with `tools/call`. A server with `listChanged` sends `notifications/tools/list_changed`. The spec says a client must treat tool annotations as untrusted unless the server is trusted.

## What cofold has today

- cofold has no MCP client. `@cofold/mcp` is a server only.
- The harness has the seam: a `Capability` contributes tools at run start, as [`code://packages/agents/src/types/capability.ts#L14-L41`](../../packages/agents/src/types/capability.ts#L14-L41) shows. Its comment says MCP servers come from a separate client package.
- Deferred tools exist. The deferred-tools plan (answer 9) says the MCP client contributes its servers with `defer: { over: 0 }`, so the model sees one index line per tool.
- A tool name must match `^[a-zA-Z0-9_-]{1,64}$`. An MCP tool name may also hold a dot and be 128 characters long.
- A tool with no `effects` runs without asking in the default mode, as [`code://packages/agents/src/policy/modes.ts#L20-L28`](../../packages/agents/src/policy/modes.ts#L20-L28) shows.
- copapo rebuilds its agent every turn ([`code://packages/copapo/src/agent.ts#L43-L76`](../../packages/copapo/src/agent.ts#L43-L76)). A connection to a server cannot live in the agent; it lives in the chat service, for the life of the process.
- copapo's configuration has no MCP key. Its schema refuses unknown keys.
- copapo reads the nearest `.copapo.json` above the workspace with no question. Once `mcpServers` is a key, a cloned repository's `.copapo.json` could start a command when a session opens there. The brief `copapo-loads-the-folder-it-trusts.md` gates that file behind trust, so it is built first.
- `copapo acp` declares no `mcpCapabilities` and ignores the `mcpServers` a client sends, as the ACP plan's `deferred.md` says.
- The claude backend starts the Claude CLI with `settingSources: ['user', 'project']`, and `strictMcpConfig` is off by default. So that backend probably already uses the CLI's own MCP configuration. This was not tested.
- The Claude Agent SDK takes `Options.mcpServers`, a map by name of stdio, SSE and HTTP servers.

## What ahpd sends

- ahpd's `serversFor` turns the deployment's MCP servers into ACP's shapes. It leaves out an HTTP server when the agent does not declare `mcpCapabilities.http`, and says so in the session.
- ahpd's own host tools go to an ACP agent as one HTTP MCP server, with a bearer token header. A stdio-only client never gets them.
- ahpd's copapo preset carries a comment that copapo ignores `mcpServers`. That comment changes when this lands.

## Who writes

- `main` at `3551a23` is the only line of work in cofold. The branches `mcp-server`, `master` and `build/agents/36756252` are fully merged into `main`.
- The working tree holds an uncommitted copapo fix in `chat.ts`, `commands.ts` and the screen. This change touches `chat.ts` and the configuration, so it starts after that fix is committed.
- In ahpd, `packages/agent-acp/src/presets.ts` is shared with other sessions. Its comment changes in an ahpd change, not in this one.

## The change

- A cofold package is an MCP client, with no third-party runtime dependency.
- It connects to a stdio server and to a Streamable HTTP server.
- It holds each connection open for the life of the process, and starts a server at its first use.
- It gives one `Capability` per set of servers. The capability lists each server's tools, deferred by default.
- A tool's name is `mcp__<server>__<tool>`, as Claude Code names it. A name that does not fit the harness's pattern is made to fit, and two names that collide are said in a warning.
- A tool's effects come from its annotations only when the configuration trusts the server. Otherwise the tool counts as one that writes and reaches the network, so the default mode asks.
- A tool result's text content becomes the tool output. `isError` becomes a tool error that the model sees.
- copapo's configuration takes an `mcpServers` map in the Claude Code shape, with `${VAR}` expansion.
- `copapo acp` declares `mcpCapabilities: { http: true }` and connects the servers a client sends with a session.
- A server that fails to start is warned once, and the session runs without its tools.

## Open points

- Where the client lives: a new package such as `@cofold/mcp-client`, or an `@cofold/mcp/client` export. `@cofold/mcp` depends on `@cofold/commands`, and the client needs `@cofold/agents`.
- Whether Streamable HTTP is written by hand over `fetch`, or comes through the official SDK as an optional peer, as `@cofold/mcp/server` does.
- Whether copapo also reads a workspace `.mcp.json`, and whether it asks before it starts a server from one, as Claude Code does.
- Whether the claude backend passes the configured and ACP servers through `Options.mcpServers`, so both backends see the same servers.
- Whether the `/` menu or a screen shows each server's state: connected, failed, or how many tools.
- Whether OAuth sign-in for an HTTP server is in scope. Claude Code and Codex both support it.
