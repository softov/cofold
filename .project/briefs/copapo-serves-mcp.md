---
title: copapo serves MCP
created: 2026-11-10
refs:
  - git://3551a23 - the commit of cofold the facts were checked at
  - "[code://packages/mcp/src/stdio.ts#L51](../../packages/mcp/src/stdio.ts#L51) - serveStdio: a registry's MCP tools over stdin and stdout, with no dependency"
  - "[code://packages/mcp/src/types/stdio.ts](../../packages/mcp/src/types/stdio.ts) - the options serveStdio takes: name, version, instructions, filter, onDiagnostic"
  - "[code://packages/copapo/src/commands.ts#L144](../../packages/copapo/src/commands.ts#L144) - the registry comment: every command is an action, so the same declarations are an MCP tool set"
  - "[code://packages/copapo/src/commands.ts#L542-L562](../../packages/copapo/src/commands.ts#L542-L562) - the acp command, the sibling a mcp command copies"
  - "[code://CLAUDE.md#L53](../../CLAUDE.md#L53) - zero third-party runtime dependencies per package; @cofold/mcp's SDK server is an optional peer"
  - https://code.claude.com/docs/en/mcp - `claude mcp serve`, Claude Code as a stdio MCP server, checked 2026-11-10
  - https://learn.chatgpt.com/docs/extend/mcp?surface=cli - Codex's `tool_timeout_sec`, 60 seconds by default, checked 2026-11-10
---

# copapo serves MCP

Softov asked on 2026-11-10 whether copapo could also be an MCP server.
The goal is that another agent drives copapo sessions as MCP tools.
That agent starts a session, says a message, answers a question, approves a tool call, and reads the reply.
copapo then works as a sub-agent for Claude Code, Codex, an ahpd session, or any MCP client.

## What others do

- Claude Code has `claude mcp serve`, a stdio MCP server that prints nothing and waits for a client. A client configures it as `{ "type": "stdio", "command": "claude", "args": ["mcp", "serve"] }`. It exposes Claude Code's own tools, such as `Read` and `Bash`, not a conversation.
- copapo's server is different: it exposes the conversation. The model on the other side talks to copapo's agent, and copapo's agent uses its own tools.

## What cofold has today

- `@cofold/mcp` 0.3.0 serves a command registry as MCP tools. `serveStdio` speaks tools over stdio with no dependency, as [`code://packages/mcp/src/stdio.ts#L51`](../../packages/mcp/src/stdio.ts#L51) shows. It refuses resources, prompts and sampling by name.
- A Streamable HTTP server exists in `@cofold/mcp/server`, through the official SDK as an optional peer.
- copapo's registry already marks these commands `mcp: true`: `say`, `queue`, `unqueue`, `approve`, `deny`, `answer`, `cancel`, `usage`, `session list`, `session show`, `session set`, `session rules`, `session delete`, `providers`, `models`, `skills`, `commands`.
- `session export`, `config`, `chat` and `acp` have no MCP surface.
- copapo does not depend on `@cofold/mcp`, and no copapo command calls `serveStdio`. No program in cofold calls it yet.
- `copapo acp` is the sibling: one `setup` action that serves a protocol on stdio and waits on `server.closed`, at [`code://packages/copapo/src/commands.ts#L542-L562`](../../packages/copapo/src/commands.ts#L542-L562).

## Who writes

- `main` at `3551a23` is the only line of work. The branches `mcp-server`, `master` and `build/agents/36756252` are fully merged into `main`.
- The working tree holds an uncommitted copapo fix in `packages/copapo/src/commands.ts` (the warnings router) and in the screen. This change adds a command to the same file, so it starts after that fix is committed.

## The change

- copapo adds `copapo mcp`, an action in the `setup` group, as `acp` is.
- It calls `serveStdio` with copapo's registry, the name `copapo` and copapo's `VERSION`.
- Stdout carries the protocol only. Warnings go to stderr through `onDiagnostic` and the chat's `warn`.
- The tools are the commands marked `mcp: true`. No command gains or loses the surface in this change.
- The session folder is the process's workspace: `--workspace` or the current directory, as the other commands use.
- copapo takes `@cofold/mcp` as a dependency. It is a workspace package, so the zero-dependency rule holds.
- The README gives a client configuration: `{ "command": "copapo", "args": ["mcp"] }`.

## Open points

- Whether `say` waits for the turn to stop, as on the CLI, or returns at once with a session id for the client to poll. A turn can take minutes, and some clients time out a tool call (Codex defaults to 60 seconds).
- Whether a Streamable HTTP mode (`copapo mcp --http`) comes in this change. It needs the official SDK as an optional peer.
- Whether the server's `instructions` say how to drive a session: start with `say`, then `answer` or `approve` when the reply waits on a decision.
