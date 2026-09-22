---
title: AGENT-02 - Deferred tools: an index in the prompt, a definition on demand
domain: agent
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core/plan.md
---

# AGENT-02 - Deferred tools: an index in the prompt, a definition on demand

## Goal

An agent with fifty tools (an MCP server or two, the standard set, a plugin) sends the model a handful of definitions and one index line per tool for the rest.
The model asks for a definition when it needs one, with `load_tools`, and from then on that tool is in the request and callable, for the rest of the session.
Nothing else changes: a loaded tool is the same `Tool`, with the same effects, the same policy, the same events.
`read_skill` already does this for skills; this does it for tools.

## Reconnaissance

### Files read

- `packages/agents/src/types/tool.ts` - `Tool { name, description, input, effects, source, execute, toModelDefinition() }`; `ModelToolDefinition { name, description, input }`.
- `packages/agents/src/types/capability.ts` - `Capability { id, tools?(args), instructions?(args) }`; resolved per run in `run.ts` `resolveCapabilities`, which stamps `source` and then rebuilds `ctx.toolDefinitions` from every tool (`run.ts:99`).
- `packages/agents/src/run/turn.ts:57,149` - `ctx.toolDefinitions` is built once (creation, then after capabilities) and sent whole on every model step (`tools: ctx.toolDefinitions`).
- `packages/agents/src/run/turn.ts:236-260` - a tool call resolves through `handleToolCall(deps, call)` against `ctx.tools`; a name not in the map is a denied call (`tool.denied`, unknown tool).
- `packages/agents/src/capabilities/skills.ts` - the precedent: index in the instructions under `## skills`, one tool that reads on demand.
- `packages/agents/src/types/agent.ts` - `AgentDefinition.tools: string[]` (names of `AgentOptions.tools` only).
- `packages/agents/src/run/resume.ts` - a resumed run rebuilds the context the same way (`createTurnContext` + capabilities), so whatever was loaded must be read from the store, not from memory.

### How the others do it

- Claude Code: `ToolSearch` with deferred tools listed by name in a system reminder; a fetched schema is callable for the rest of the conversation.
- OpenAI Responses API and Gemini: no deferral; every function is sent every call. MCP clients (Cursor, Cline) send everything and hit the limit at ~40 tools.

### Gaps

- `Not found: any notion of a tool that is known but not sent` - everything in `ctx.tools` is in every request.
- `Not found: a place to keep "loaded this session"` - the session kv (`kv.workspace` is per workspace, `kv.agent` per agent); the run's own record is per run. Written here as a per-session key in the agent scope, beside `approvals/<sessionId>/<tool>` (decision 63 uses the same scope for the same reason).

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | `ToolDefinition.deferred?: boolean`, carried onto `Tool`. `createTool` keeps it; the model definition is unchanged | One field, no second contract |
| 2 | `Capability.defer?: boolean \| { over: number }`: `true` marks every contributed tool deferred; `{ over: N }` marks those past the first N (in the capability's order). `run.ts` applies it while stamping `source` | A capability that contributes many tools (an MCP server) says so once |
| 3 | The request carries the definitions of the tools that are not deferred plus the ones loaded this session, in that order. Deferred, unloaded tools appear in the instructions under `## tools` as `- name: <first sentence of the description>`, after a rule: "These tools exist but their definitions are not loaded. Call load_tools with their names, or a query, to get the definitions before using one; do not guess their arguments." The section exists only when at least one tool is deferred and unloaded | Same shape as `## skills` |
| 4 | One core tool, `load_tools({ names?: string[]; query?: string })`, present only when something is deferred. With neither argument it returns the index (name and first sentence, every deferred tool). With `names` it returns the full `ModelToolDefinition`s as JSON and loads them; with `query` it matches the words case-insensitively against name and description, returns and loads the matches (at most 10). An unknown name is named in the result, the rest still load. `effects: {}` (never asks) | Naming: snake_case like `ask_user`, `read_skill`; one tool rather than two |
| 5 | Loaded names are stored at `kv.agent` key `loaded-tools/<sessionId>` as `string[]` (the writer is the run, under the fence); the request is rebuilt from `ctx.tools` after every `load_tools` result, and `createTurnContext` / `resolveCapabilities` read the key so a resumed run and the next turn start with them loaded. A new session starts clean | Same scope and shape as `approvals/<sessionId>/<tool>` (decision 63) |
| 6 | A call to a deferred tool that was never loaded is executed anyway if the arguments validate (the model may have remembered the schema from an earlier session); the definition is loaded as a side effect. What is denied is what is denied today: unknown names and invalid arguments | Refusing a valid call to make a point costs a step for nothing |
| 7 | `AgentDefinition.tools` stays the agent's own names; `AgentDefinition.deferred: string[]` lists the deferred ones among them (capability tools are per run and are not in the definition, as today) | An adapter that advertises the agent can say what is on demand |
| 8 | Events: none new. `load_tools` is a tool call like any other (`tool.proposed`, `tool.started`, `tool.completed`); the step log has it | Nothing to add to the projection in papo |
| 9 | `@cofold/tools` (TOOLS-01) stays non-deferred by default; the MCP client (its own plan) contributes its servers with `defer: { over: 0 }` unless told otherwise; papo exposes nothing new | The program decides; the harness has the mechanism |

## Proposed architecture

```
packages/agents/src/
  types/tool.ts             UPDATE: deferred?: boolean on ToolDefinition and Tool
  types/capability.ts       UPDATE: defer?: boolean | { over: number }
  types/agent.ts            UPDATE: AgentDefinition.deferred: string[]
  types/turn.ts             UPDATE: TurnContext.loaded: Set<string>
  tool/create-tool.ts       UPDATE: carries deferred
  tool/load-tools.ts        CREATE: createLoadToolsTool(ctx) - the index, the matcher, the loader
  run/turn.ts               UPDATE: requestToolsOf(ctx) replaces ctx.toolDefinitions; the `## tools` section; reload after a load_tools result
  run/run.ts                UPDATE: resolveCapabilities applies defer, reads loaded-tools/<sessionId>, adds load_tools when needed
  run/deferred.test.ts      CREATE
  agent/create-agent.ts     UPDATE: definition.deferred
docs/agents/                UPDATE: the tools page
```

- **`requestToolsOf(ctx)`**: `[...ctx.tools.values()].filter((t) => !t.deferred || ctx.loaded.has(t.name)).map((t) => t.toModelDefinition())`, computed before each model step.
- **`## tools` section**: computed with the instructions before each model step, from the deferred tools not in `ctx.loaded`.
- **`load_tools`**: reads `ctx.tools` and `ctx.loaded` through `ToolContext.resources`? No: it is created by `run.ts` with a closure over `ctx`, like the skills tool closes over its index, and stamped `source: 'core'`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the field, the capability option, the definition split](task-01-field-capability-option-definition-split.md) | done | - |
| [02 - `load_tools` and the session memory of it](task-02-load-tools-session-memory.md) | done | 01 |
| [03 - docs](task-03-docs.md) | done | 02 |

## Risks and tradeoffs

- Small models may ignore the index and call `load_tools` never or always; the rule text and the first-sentence summaries are what steer them. Decision 6 keeps a remembered schema usable.
- The `## tools` section costs one line per deferred tool; at hundreds of tools it is a page. The next step, if it comes, is `query`-only discovery with no index, which is a rule change, not a contract change.

## Resume state

- **Done so far:** plan written 2026-09-16; Tasks 1-3 built 2026-09-16. `run/deferred.ts` holds `requestToolsOf`, `instructionsOf`, `markLoaded`, `readLoaded`, `createLoadToolsTool` (source `core`); `TurnContext.toolDefinitions` is gone (the request is computed per step); `ToolCallDeps.loaded` lets `handleToolCall` apply decision 6; a `query` needs every word to match. 7 tests in `run/deferred.test.ts`; the file store's kv passes the conformance suite, so no second run there.
- **Next action:** the MCP client plan contributes its servers with `defer: { over: 0 }` (decision 9); papo exposes nothing.
- **Open questions:** none.
- **Watch out for:** `resolveCapabilities` failing a run on a duplicate name; `load_tools` is a core name no capability may take.

## Final verification checklist

- [x] `pnpm check` green (562 tests).
- [x] The cases of Task 2 pass on the memory store; the file store's kv is covered by the conformance suite.
- [x] `index.md` updated.
