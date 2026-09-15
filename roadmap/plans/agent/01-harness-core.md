<!--
Domain: agent
Status: In progress
Priority: High
Created: 2026-09-13
Revalidated: 2026-09-15
Dependencies: —
Reference: ./00-agent.md
-->

# AGENT-01 - Harness core (parent)

_Status: In progress · Priority: High · Created: 2026-09-13_

This is a split plan.
It holds the goal, reconnaissance, locked decisions, architecture, and the phase map.
Each phase is a child plan; only [p1](01-harness-core-p1-contracts.md) is written in full at this point.

## Goal

Build `@facio/agents`: a TypeScript agent runtime that conducts a conversation with a model, offers tools, executes authorized tool calls, assembles context, manages one turn as a run, and exposes what happens through a run handle.
It runs standalone against a local Chat Completions server or OpenRouter, and the same runtime is hosted by `ahpd` through an adapter without changing its model/tool loop.
The agent is the heart; the harness (stores, transports, tools, memory, networks) is built on top of it through one options object and two hook families, never through subclassing.

## Reconnaissance

### Files read

- `roadmap/specs/agent-harness-spec.md` - the specification; every section maps to a phase below.
- `ahpd/packages/sdk/src/types/agent.ts` (softov/ahpd) - `Agent` (provider, displayName, chats, multipleDirectories, protectedResources, schema(), defaults(), probe?, directories?, list?, transcript?, create(start)), `BoundTool { definition, run?, owner? }`, `Start { uri, chatUri, settings, tools?, emit, resume?, forkAt?, rewindAt?, credentials? }`.
- `ahpd/packages/sdk/src/types/session.ts` (softov/ahpd) - `Session` (uri, chatUri, models(), agentId(), forkPoint?, endPoint?, begin(turnId, text, model?), steer?, resume?, cancel, queue, confirm(toolCallId, approved), setTools?, toolCallOwner?, completeToolCall?), `Emit(channel, action)`, `Chosen { id, config }`.
- `ahpd/packages/agent-claude/src/{claude,session,transcript}.ts` - the only existing backend; the p4 adapter mirrors its structure.
- `F:\github\facio\src\core\command.ts:192-270` - `Field = JsonSchema & { cli?, env? }`, `ActionDefinition { id, summary, input, required, surfaces, needs, refine?: StandardSchemaV1, run(context) }`.
- `F:\github\facio\package.json` - tsc build, vitest, `engines.node >= 22`, zero runtime deps, `exports` map with sub-paths; the style to match.
- `roadmap/research/agent-harness-survey.md` (context and events sections) - the canonical-transcript vs derived-model-view split ("transform must not throw") and event unions with agent/turn/message/tool lifecycle, as seen across the surveyed harnesses.
- Survey, persistence section - writer claim (`activeWriterRunId`) fence on transcript appends.
- `opendoop/pood/src/runtime/agents/agent-worker.runtime-types.v4.ts` - `IterationOutcome` closed union, `ToolEffects`, `LoopExitReason`.
- `opendoop/packages/sdk/src/provider/tool.ts` - `ToolManifest` fields (`accessClass`, `sandbox`, `sequential`, `requiresHumanApproval`, `availableWhen`, `surfaces`).
- `roadmap/research/agent-harness-survey.md` - the survey; sections 1-12 list every feature considered in or out of scope.

### Searches performed

- `ls` of the agents repository - it did not exist beyond `roadmap/`; nothing to reuse in-tree.
- `npm view @facio/core` - 404; the `@facio` scope is unused (the user owns `facio`).
- `grep -n "export interface Agent\|export interface Session" ahpd/packages/sdk/src/types/*.ts` - located the two contracts above.
- `grep -n "StandardSchemaV1\|export type Field" facio/src/core/*.ts` - facio validates JSON Schema fields itself and accepts an optional Standard Schema `refine`.

### Runtime path (target, not yet existing)

```
host (CLI / ahpd adapter / example)
  → createAgent({ id, instructions, model, tools, store, hooks, limits, context, resources })   data + bound deps, no methods
    → run({ agent, session, input })                      standalone function, returns RunHandle immediately
      → store.runs.create + claimWriter(session, runId)
      → loop: assemble context → hooks.beforeModel → model.complete → hooks.afterModel
              → for each toolCall: validate input → hooks.beforeTool → policy → execute → hooks.afterTool
              → store.sessions.appendMessages (canonical) + store.runs.appendStep + appendEvent(seq)
      → outcome: completed | awaiting | stopped | cancelled | failed
    ← run.events (AsyncIterable<RunEvent>), run.submit(command), run.cancel(), run.outcome
```

### Existing patterns to reuse

- `facio/src/core/command.ts` single-object definitions with JSON Schema input; `createRegistry()` factory style.
- `ahpd/packages/agent-claude/src/session.ts` mapping of a backend's events to `emit('session' | 'chat', action)`.
- The canonical-messages vs derived-model-messages split used by several surveyed harnesses.

### Gaps

- `Not found: any existing TS harness with stable tool invocation IDs and uncertain-invocation recovery - searched "invocationId|idempotency" across the surveyed harnesses.` Designed here from the spec.
- ahpd `Session.confirm(toolCallId, approved)` is boolean; the harness approval decision is richer (`approve | deny` with reason). p4 maps down.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Packages published as `@facio/*`, core is `@facio/agents`. (Started in its own repository; since 2026-09-16 part of the `facio` workspace, see `roadmap/plans/repo/01-workspace.md`) | User. The command framework is `@facio/commands`; `facio` is reserved for the program |
| 2 | Functional API only: `createAgent`, `createTool`, `createMemoryStore`, `openaiCompat`, ... No classes except `Error` subclasses | User: "keep the functional calls for now". Subclassing can be added later by making `createAgent` return a class instance |
| 3 | Every factory takes exactly one options object and returns one value; no positional parameters, no definition/deps split | User: "only one object, not multiple params" |
| 4 | `createTool` (not `defineTool`) | User |
| 5 | Tool input is a full JSON Schema object (`{ type: 'object', properties, required, ... }`) | User (asked 2026-09-13). Matches MCP/OpenAI wire shape 1:1 |
| 6 | `@facio/agents` has zero runtime dependencies: own JSON Schema validator subset, native `fetch`, `crypto.randomUUID` | User (asked 2026-09-13), matches facio |
| 7 | No tools by default; `tools` absent means the model gets no tool definitions | User |
| 8 | Store keyed by session; agent-scoped KV and shared KV scopes live next to it in the same store | User: "key the store by session, with agent-scoped and shared KV scopes next to it" |
| 9 | Two hook families: intervention hooks return decisions (`beforeModel`, `afterModel`, `beforeTool`, `afterTool`); observers consume `RunEvent`s and return nothing | Spec "Events versus hooks"; user agreed |
| 10 | Every model step and tool execution is a step-log entry with a stable `invocationId`; recovery replays the log | Spec "Persistence and recovery"; user agreed (Inngest step idea) |
| 11 | Tools declare `effects: { reads?, writes?, network?, destructive? }` | Spec; needed by code mode's parallel rule later |
| 12 | Serial tool execution only in phases 1-4 | Spec "Start with serial tool execution" |
| 13 | First model adapter is non-streaming Chat Completions (`@facio/model-openai-compat`) covering OpenRouter and LM Studio; adapters report `features` and reject unsupported required features | Spec "Model adapters" |
| 14 | Run outcome statuses: `completed`, `awaiting`, `stopped`, `cancelled`, `failed`; never a single "done" | Spec "Turn lifecycle" |
| 15 | `@facio/agents` never imports `facio`; `fromFacioAction()` is a separate adapter (later plan) | User agreed |
| 16 | Message parts in v1 contract: `text`, `image`, `toolCall`, `toolResult` | User (asked 2026-09-13) |
| 17 | Token estimation: `chars / 4` default, `context.estimateTokens` pluggable, adapter may expose `estimateTokens` | User (asked 2026-09-13) |
| 18 | Tooling: pnpm workspace, vitest, tsc (no bundler), ESM only, Node >= 22, strict TS | User (asked 2026-09-13) |
| 19 | Plan shape: this parent + five children mirroring the spec's build sequence; p1 in full | User (asked 2026-09-13) |
| 20 | Only `roadmap/` is created by planning; scaffold is task 1 of p1; the user owns git (no `git init` by the assistant) | User (asked 2026-09-13) |
| 21 | Intervention hook that throws fails the run with `failed { code: 'hook_error' }`; observer errors are logged and never affect the run | (defaulted: spec requires "failure behavior" per hook; safest reading) |
| 22 | Default limits: `maxSteps 20`, `maxToolCalls 50`, `timeoutMs 0` (none), `maxToolOutputChars 16000` | (defaulted: trivially reversible, written into `limits.ts`) |
| 23 | IDs: `runId`, `callId` (when the model omits one), `invocationId`, `requestId`, `messageId` are `crypto.randomUUID()`; `sessionId` and `agentId` are caller-supplied strings | (defaulted) |
| 24 | Event identity is `(runId, seq)`, seq starts at 1 and is contiguous; the store rejects a gap | Spec "sequence number" |
| 25 | `store` absent → `createMemoryStore()` is used and a one-line warning is logged once | User: "absent store means in-memory (tests only, and the agent says so)" |
| 26 | Hook signatures take one object and return one object, same rule as factories | Decision 3 applied to hooks |
| 27 | `run()` and `resume()` are standalone functions: `run({ agent, session, input, signal? })`, `resume({ agent, sessionId, runId, afterSeq? })`. `Agent` (the `createAgent` result) is a frozen value with `definition`, `model`, `tools`, `store`, `hooks`, `limits`, `context`, `params`, `resources` and no methods | User: "the run is separated from the agent"; the harness runs the agent, the agent is the heart |
| 28 | First durable store is `@facio/store-file` (JSONL per session and run, `writer.lock` as the fence). SQLite and Durable Object stores are later packages behind the same `Store` contract | User: "files is first. sqlite is pluggable" |
| 29 | **Workspace** is a host-supplied session partition key (`SessionRecord.workspace`, `RunArgs.workspace`): the CLI passes `process.cwd()`, the AHP transport passes `SessionOptions.cwd`, chat hosts pass nothing. The harness owns the concept, its kv scope (`{ kind: 'workspace' }`), `sessions.list({ workspace })`, and the on-disk slug; hosts own only the root and the key. Nothing in `@facio/agents` reads `os.homedir()` or `process.cwd()` | User (2026-09-14): mirror the `<home>/projects/<cwd-slug>/` layout coding harnesses use, but keep the harness host-agnostic so CLI and ahpd share one on-disk state |
| 30 | Runs are stored under their session (`sessions/<sessionId>/runs/<runId>/`); every run-level `Store` call and `resume()` carry `RunRef { sessionId, runId }`; the `awaiting` outcome returns both. No run index, no scanning | User (2026-09-14): a copied session folder must carry its runs; p3 acceptance depends on it |
| 31 | **Capabilities** are the one extension slot for tools-plus-instructions: `AgentOptions.capabilities: Capability[]`, each `{ id, tools?(args), instructions?(args) }`, resolved by `run()` at run start (not at `createAgent`) so an MCP server's tool list or a skills folder can change between runs. Contributed tools are re-stamped `source = capability.id`; agent tools are `source = 'agent'`. `request.instructions` = `definition.instructions` + one `## <id>` section per capability that returned text, recorded verbatim in the model step. Duplicate tool names across agent and capabilities → `invalid_options` at run start. Skills live in the core: `types/skills.ts` defines `SkillSource { list, read }` and `SkillIndexEntry`; `capabilities/skills.ts` ships `skills({ sources: SkillSource[] })` (p3), zero deps, no `node:` import, `sources` required and never defaulted from the store (skills are content, `Store` is runtime state; mounting them on `Store` would tax every store implementation with fs code). `@facio/store-file` exports `fileSkillSource({ root, workspace? })` next to `createFileStore`; a DB store or the AHP transport implement the same two methods. MCP stays a client package, `@facio/tools-mcp`, because it owns `@modelcontextprotocol/sdk` and the transports; it returns one capability per server (`id: 'mcp:<server>'`) and touches the store only through kv (tool-list cache, OAuth tokens) | User (2026-09-14). Mirrors the capability pattern (`tools()` + `instructions()`) of the OpenAI Agents SDK |

## Proposed architecture

- **Data flow.** Input → `Message` appended to the session transcript → context assembler builds a `ModelRequest` view (instructions + recent history within `context.maxTokens`) → adapter → `ModelReply` appended → tool calls validated and executed one at a time → `toolResult` parts appended → repeat until a reply has no tool calls or a limit is hit.
- **Event flow.** The loop writes the step record and the transcript first, then appends the `RunEvent` with the next seq, then pushes it to the in-memory subscribers of the run handle. A reconnecting observer reads `store.runs.listEvents({ runId, afterSeq })` and continues from the live stream.
- **State flow.** `RunRecord.status`: `running → completed | awaiting | stopped | cancelled | failed`; `awaiting → running` on a resolving command (p3). Transitions are persisted before the matching event is published.
- **Layer responsibilities.**
  - `@facio/agents`: contracts, JSON Schema validation, memory store, fake model, `createAgent` (resolves options into a frozen `Agent` value), `run` / `resume` (the loop and run handle), step log, context assembler (recent history only).
  - `@facio/model-openai-compat`: HTTP, headers, retries, response decoding, feature flags.
  - `@facio/store-file` (p3): first durable implementation of the `Store` contract (JSONL per session and run, lock file as writer fence). `@facio/store-sqlite` and a Durable Object store come later behind the same contract.
  - `@facio/transport-ahp` (p4): `Agent`/`Session` from `@ahpd/sdk` on top of `createAgent` + `run()`.
  - `examples/`: the "harness uses the agent" hosts.
- **Source-of-truth files.** `packages/agents/src/types/{message,tool,model,event,command,outcome,store,hooks,agent,run}.ts`. Everything else imports from `@facio/agents`.

## Phase map

| Phase | Child | Objective | Status |
| --- | --- | --- | --- |
| p1 | [01-harness-core-p1-contracts.md](01-harness-core-p1-contracts.md) | Workspace scaffold, contracts, JSON Schema validator, `createTool`, memory store, fake model, chat-completions adapter, tests, adapter smoke example | Shipped 2026-09-15 |
| p2 | [01-harness-core-p2-loop.md](01-harness-core-p2-loop.md) | `createAgent()` + standalone `run()`: bounded serial loop, validation, cancellation, ordered events, run handle; prove tool → result → final answer | Shipped (2026-09-15) |
| p3 | [01-harness-core-p3-durable-hitl.md](01-harness-core-p3-durable-hitl.md) | `@facio/store-file`, paused approvals with durable `requestId`, `resume()`, writer fence; prove pause → lose observer → resume without double execution | Shipped 2026-09-16 |
| p4 | [01-harness-core-p4-ahpd-adapter.md](01-harness-core-p4-ahpd-adapter.md) | `@facio/transport-ahp` implementing `@ahpd/sdk` `Agent`/`Session`; verify with `ahpc` | Not started |
| p5 | [01-harness-core-p5-streaming-context-usage.md](01-harness-core-p5-streaming-context-usage.md) | Steering, hook stop, thinking levels, dynamic keys, cache key (Tasks 1-4, planned in full); streaming, context reduction, usage accounting, second adapter (Tasks 5-8, outlined) | Planned in part (Tasks 1-4) |

Children declare dependencies by filename.
A later phase must not assume an earlier phase's infrastructure unless that phase is marked complete in `index.md`.

## Out of scope for AGENT-01 (named so nobody smuggles them in)

Code mode (`run_code` + generated `.d.ts` + isolate), guardrail package, `agentAsTool`, `createNetwork`, memory hooks, SQLite and Durable Object stores, JSON-RPC / WS / HTTP / MCP-server transports, `fromFacioAction()`, parallel tool execution, session fork / rewind (contract slots only in p3).
Each gets its own plan in its domain folder.

## Cross-layer consistency

One concept, one type, from `packages/agents/src/types/`.
Adapters, stores, transports, and examples import `@facio/agents` types and never redeclare `Message`, `Tool`, `RunEvent`, `RunCommand`, `RunOutcome`, `Store`.
`@facio/transport-ahp` maps to `@ahpd/sdk` types at its boundary only.

## Risks and tradeoffs

- Zero-dependency JSON Schema validation means a subset; the subset is listed in p1 and the validator rejects unsupported keywords loudly instead of ignoring them.
- Non-streaming first means the CLI feels slow on long answers until p5; accepted by the spec.
- The in-memory store is the only store until p3; every p2 test must also pass against `@facio/store-file` once it exists (p3 re-runs the p2 suite), and against any later store.

## Resume state

- **Done so far:** roadmap tree written; p1 built 2026-09-15 (workspace, contracts, validator, `createTool`, memory store, fake model, `openaiCompat`, smoke example; 60 tests green). Decisions 39-45 added in p1 (build-first root scripts, explicit vitest projects, review fixes, model catalog, reasoning).
- **Next action:** run the p1 smoke against LM Studio / OpenRouter (see p1 Resume state), then `/dooit` on [01-harness-core-p3-durable-hitl.md](01-harness-core-p3-durable-hitl.md). p2 shipped 2026-09-15 (decision 66 added).
- **Open questions:** none.
- **Watch out for:** the `@facio` npm scope must be claimed by the user before the first publish; the package names in this plan assume it.

## Final verification checklist

- [ ] p1 through p4 shipped and validated per their own checklists.
- [ ] One agent definition runs standalone against LM Studio and OpenRouter (`examples/standalone`).
- [ ] The same agent is hosted by `ahpd` and driven from `ahpc`: turn, tool approval, cancellation, reconnect, history.
- [ ] No contract drift: every package imports shapes from `@facio/agents`.
- [ ] `index.md` statuses updated.
