---
title: The MCP client reads a server's skills
domain: agent
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
refs:
  - "[code://packages/mcp-client/src/connect.ts#L10-L21](../../../../packages/mcp-client/src/connect.ts#L10-L21) - `McpConnection`, which lists and calls tools only"
  - "[code://packages/mcp-client/src/connect.ts#L68-L90](../../../../packages/mcp-client/src/connect.ts#L68-L90) - `initialize`, which reads only the `tools` capability"
  - https://modelcontextprotocol.io/seps/2640-skills-extension - SEP-2640: the `io.modelcontextprotocol/skills` extension, `skills/list`, `skills/get`, and skill files read with `resources/read`
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `McpServerCustomization.children`, which ahpd fills from this client
---

## Goal

A connection of `@cofold/mcp-client` says whether its server serves skills. It lists them, gets one, and reads a skill's files. ahpd uses it to show and load the skills an MCP server serves.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "request\(" packages/mcp-client/src/connect.ts` on 2026-11-24 - the connection sends `initialize`, `tools/list` and `tools/call` only.
- SEP-2640 - a server declares the `io.modelcontextprotocol/skills` extension and the `resources` capability, and answers `skills/list` and `skills/get`.

### Gaps

- The connection keeps no capability but `tools`.
- No method lists skills or reads a resource.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd's MCP-served skills use this client, extended | Softov, 2026-11-24, chose "Extend @cofold/mcp-client" | 01 |
| The connection keeps the server's `capabilities` | `(defaulted: the skills extension is read from them)` | 01 |
| `skills()` lists every page, as `tools/list` is listed | `(defaulted: the pattern the connection already has)` | 01 |
| A server without the extension answers `skills()` with no call | `(defaulted: a call it does not serve would fail)` | 01 |

## Proposed architecture

- **Data flow** - `initialize` keeps `capabilities`; `skills()` sends `skills/list`, `skill(uri)` sends `skills/get`, and `read(uri)` sends `resources/read`.
- **Layer responsibilities** - `@cofold/mcp-client`: the three calls and their types.
- **Source-of-truth files** - [`code://packages/mcp-client/src/connect.ts`](../../../../packages/mcp-client/src/connect.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a connection reads skills](task-01-a-connection-reads-skills.md) | done | - |

## Risks and tradeoffs

- SEP-2640 may still change its wire - the types follow the SEP page on the day of the build, and the code cites the page.

## Resume state

- **Done so far:** task 01, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** a skill's supporting files are read by URI and are not in `resources/list`.

## Final verification checklist

- [ ] A connection to a fake server with the extension lists, gets and reads a skill.
- [ ] A connection to a server without it answers no skills and sends no call.
- [ ] `pnpm test` passes in the repository.
