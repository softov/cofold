<!--
Domain: cli
Status: Not started
Priority: High
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: ../agent/01-harness-core-p3-durable-hitl.md (shipped); textui `roadmap/plans/chat/01-textui-chat.md` (@textui/chat must exist)
Reference: ./00-cli.md
-->

# CLI-01 - `@facio/chat`: the harness in a terminal

_Status: Not started (unblocked 2026-09-16: `@textui/chat` shipped) · Priority: High · Created: 2026-09-16_

## Goal

A person runs `facio-chat` in a project folder and talks to an agent that runs **in this process** on `@facio/agents`: sessions persist under `~/.facio` per workspace, a turn streams into the transcript, a destructive tool stops and asks, `ask_user` shows its questions, the model is picked from what the configured provider lists, and closing the terminal mid-approval loses nothing (`facio-chat` again shows the session waiting).
This is the first end-to-end use of the harness by a human and the validation the spec asks for before the ahpd adapter.
The UI is `@textui/chat` (textui plan CHAT-01); this package is a `HostConnection` over the harness plus the program around it.

## Reconnaissance

### Files read

- `packages/agents/src/index.ts` - public surface used here: `createAgent`, `run`, `resume`, `createAskUserTool`, `skills`, `newId`, `textOf`, `toolCallsOf`, types.
- `packages/agents/src/types/{run,outcome,event,store,ask,provider}.ts` - `RunHandle` (events, submit, cancel, outcome), `RunEvent` union, `RunOutcome`, `Store.sessions.list / runs.list`, `RunRecord.inputMessageId` (written by `run.ts:62`), `AskQuestion` / `AskAnswers`, `ModelProvider.listModels`.
- `packages/agents/src/run/turn.ts:229-339` - messages are appended in order by the writer run only; a run's messages are the transcript slice from its `inputMessageId` up to the next run's `inputMessageId` (no `lastMessageId` needed; it is not maintained by the loop).
- `packages/model-openai-compat/src/index.ts:38` - `openaiCompatProvider({ baseUrl, apiKey?, headers?, name? })` → `ModelProvider` with `listModels()` over `GET /models` and `model({ id, features?, params? })`.
- `packages/store-file/src/index.ts` - `createFileStore`, `resolveHome`, `workspaceSlug`, `fileSkillSource`.
- `F:\github\ahpc\src\ahp\connection.ts`, `types.ts` - the seam and the domain as `@textui/chat` will export them: `HostConnection` core members (Recon of CHAT-01), `HostEvent`, `SessionSummary` + `SessionFlag` bits, `Turn`, `ResponsePart`, `ToolCall`, `PendingInput`, `Question`, `Answer`, `Agent`, `ModelRow`, `ModelSelection`, `SessionConfig`, `ConfigProperty`.
- `F:\github\textui\examples\chat\src\ahp\claude.ts:10-40` - the in-process connection precedent and what it refuses (queue, changeset, onSessions); the facio connection can answer two of the three because the store is real.

### Searches performed

- `rg "lastMessageId" packages/agents/src/run` - never written; grouping uses `inputMessageId` only.
- `rg "SessionFlag" F:\github\ahpc\src\ahp\types.ts` - `Idle 1, Error 2, InProgress 8, InputNeeded 24, IsRead 32, IsArchived 64`; `InputNeeded` includes `InProgress`.

### Runtime path

```
facio-chat [--workspace <dir>] [--model <provider/model>] [--static ...]
  → config: ~/.facio/chat.json + FACIO_BASE_URL / FACIO_API_KEY / FACIO_MODEL (Task 2)
  → store = createFileStore({ root: resolveHome({ name: 'facio' }) })
  → providers = [openaiCompatProvider(...)] per config entry
  → host = facioHost({ store, providers, workspace, agentId: 'chat' })          (Task 3)
  → registerChat(app, { host, workspace }) from @textui/chat; createNodeTerminal; app.start()
  say(uri, text, model) → agent = buildAgent(model, permissionMode) → run({ agent, session, workspace, input })
      → RunHandle.events → HostEvent (Task 4) → subscribe observers
  confirmToolCall / completeInput → resume({ agent, sessionId, runId }).submit(...)
  listSessions → store.sessions.list({ workspace }) + runs.list per session → SessionSummary
  subscribe(uri) → snapshot from store (turns from messages + runs) → live events while a run is attached
```

### Existing patterns to reuse

- `examples/agents/pause-resume.ts` - the exact `run` → `awaiting` → `resume` → `submit` sequence the connection performs.
- `packages/store-file/src/skills.ts` `fileSkillSource` - the skills source for the `skills()` capability.
- `@textui/chat/fake` `describeHostConformance` (CHAT-01 decision 7) - run against `facioHost` with the fake model.

### Gaps

- `Not found: a Message → Turn projection or a RunEvent → HostEvent projection anywhere - searched "Turn|HostEvent" in packages/.` Written here (`turns.ts`, `events.ts`).
- `SessionSummary.title` has no source: `SessionRecord` has no title. Derived from the first input message (decision 6).
- Read / archived flags have no store slot: kept in the workspace kv scope (decision 7).
- Streaming deltas: the harness emits `model.delta` only from p5; until then a turn's text arrives whole at `model.completed` (decision 9).

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Package `@facio/chat` in `packages/chat/`, binary `facio-chat`; depends on `@facio/agents`, `@facio/model-openai-compat`, `@facio/store-file` (`workspace:*`) and `@textui/chat`, `@textui/core`, `@textui/terminal` via **`link:../../../textui/packages/<name>`** until textui `0.6.0` is published, then `^0.6.0` | User (2026-09-16) |
| 2 | The connection implements the **core** `HostConnection` members only: `state`, `listSessions`, `agents`, `resolveConfig`, `createSession`, `disposeSession`, `setArchived`, `setRead`, `subscribe`, `onSessions`, `setDraft`, `say`, `stopTurn`, `queue`, `unqueue`, `confirmToolCall`, `completeInput`, `detail`, `config`, `setConfig`, `close`. No `terminals`, `changes`, `resource*`, `automations`, `customizations` (CHAT-01 decision 3 hides those screens) | (defaulted: nothing in the harness backs them yet; skills → customizations is a later addition) |
| 3 | One agent definition per session, rebuilt from config on every `say`: `createAgent({ id: 'chat', instructions, model: provider.model({ id }), tools: [createAskUserTool()], capabilities: [skills({ sources: [fileSkillSource({ root })] })], store, policy, limits, params })`. `instructions` come from `~/.facio/chat.json` `instructions` (default: a short assistant prompt) plus `<workspace>/AGENTS.md` when present | (defaulted: the agent is a value; rebuilding is cheap and keeps model/permission changes honest) |
| 4 | Session config exposed to the composer bar (`SessionConfig.properties`): `model` (values from `listModels`, `sessionMutable: true`), `permissions` (`ask` = approval on every tool, `destructive` = default policy, `auto` = never ask; `sessionMutable: true`), `workspace` (display only). `resolveConfig` returns the same schema with defaults from config; values persist in the workspace kv under `chat/session/<sessionId>/config` | (defaulted: the three chips the UI already draws) |
| 5 | Session identity: `SessionUri = 'facio:' + sessionId`; `createSession` allocates `newId()` and writes nothing (the first `say` creates the store session, decision 29 workspace); `disposeSession` deletes the session folder through a new `Store.sessions.delete({ sessionId })` (core addition, Task 1) and cancels an attached run | (defaulted) |
| 6 | `SessionSummary`: `provider 'facio'`, `title` = first 60 chars of the first input message (`RunRecord.inputMessageId` of the oldest run) or `sessionId`; `status` from the newest run: `running` → `InProgress`, `awaiting` → `InputNeeded`, `failed` → `Error`, else `Idle`; `IsRead` / `IsArchived` from kv (decision 7); `workingDirectories: [workspace]`; `createdAt` / `modifiedAt` from the record | (defaulted) |
| 7 | Client flags live in the workspace kv scope: `chat/read/<sessionId>: boolean`, `chat/archived/<sessionId>: boolean`, `chat/draft/<sessionId>: string` (`setDraft`), `chat/session/<sessionId>/config` | (defaulted: same store, no parallel persistence) |
| 8 | Turn projection (`turns.ts`, pure): group the transcript by run (`runs.list` ascending by `createdAt`; a run's slice starts at its `inputMessageId` and ends before the next run's); per run emit a `user` Turn (the input text) and an `agent` Turn with `parts` in transcript order: assistant text → `markdown`, `reasoning` part → `reasoning`, each `toolCall` → `toolCall` (`status` from the matching `toolResult`: `completed` / `failed` when `isError`, `pending-confirmation` when the run is awaiting on that `callId`, `cancelled` when the run ended without a result), `run.finished` failed → an `error` part. `Turn.state`: `running` while the run is `running` / `awaiting`, else `complete` / `cancelled` / `failed` by outcome | (defaulted) |
| 9 | Event projection (`events.ts`): `run.started` → `turnStarted` (user turn + empty agent turn); `model.completed` → `delta` per text / reasoning part (whole text; p5's `model.delta` maps to the same event incrementally later); `tool.proposed` → `toolCall pending`; `tool.started` → `running`; `tool.completed` → `completed` / `failed` with `output`; `tool.denied` → `failed` with `outcome` = reason; `approval.requested` → `inputNeeded { kind: 'toolConfirmation', id: requestId, call }`; `input.requested` → `inputNeeded { kind: 'chatInput', id: requestId, message, questions }`; `approval.resolved` / `input.resolved` → `inputResolved`; `run.finished` → `turnComplete` with the projected turn, plus `status`. Every event also refreshes `status` | (defaulted: one function, tested against the fake model) |
| 10 | Question mapping: `AskQuestion` → `Question { id, kind: options ? (multiSelect ? 'multi-select' : 'single-select') : 'text', message: question, required: true, options: options.map(o => ({ id: o.label, label: o.label })), allowFreeformInput: allowOther !== false }`. `Answer` → `AskAnswers`: `selected` → label, `selected-many` → labels, `text` → value, `number` / `boolean` → `String(value)` | CHAT-01 decision 10 |
| 11 | `confirmToolCall(uri, toolCallId, approved)` → `resume({ agent, sessionId, runId }).submit({ type: approved ? 'approve' : 'deny', requestId })` where `runId` / `requestId` come from the session's awaiting run and its `pendingRequestId`; `optionId === 'always'` → `alwaysApprove: true`. `completeInput(uri, requestId, accepted, answers)` → `submit({ type: 'answer', answers })`; `accepted === false` → `submit({ type: 'cancel' })` | Decisions 48, 69, 75-77 of the harness plans |
| 12 | Queue: the process is the host, so the queue is real: `queue(uri, text)` appends to an in-memory list per session, `unqueue` removes, `queued` events are emitted, and when the attached run finishes `completed` the head is sent with `say`. Not persisted (a restart drops the queue; a queued message is not a turn yet) | (defaulted: the seam warns against a client-side queue; this is the host side) |
| 13 | `onSessions` fires after every `say`, `run.finished`, `setArchived`, `setRead`, `disposeSession` in this process (no cross-process watch in this plan) | (defaulted) |
| 14 | `state()` is `'connected'` once the provider's `listModels` has answered at least once, `'connecting'` before, `'offline'` after a `ModelError` of code `network` / `auth` from it; `HostEvent { type: 'error' }` carries provider errors to the status bar with the code | (defaulted: mirrors the "a host that says no is answering" rule) |
| 15 | A run attached in-process is tracked in `Map<sessionId, RunHandle>`; `subscribe` on a session with an attached run replays `handle.events` from seq 1 (the handle buffers) after the store snapshot; a session whose newest run is `awaiting` or `running` with no handle (previous process) gets a `resume()` handle lazily on first `subscribe`, which also performs crash recovery (harness decision 78) | (defaulted) |
| 16 | Program flags: `--workspace <dir>` (default `process.cwd()`), `--model <id>`, `--home <dir>` (default `resolveHome({ name: 'facio' })`), `--static --width --height` passthrough to the terminal, `--theme`, `--shell`. No `--host` | (defaulted: the example's flags minus the socket) |
| 17 | Streaming: until harness p5 ships, prose arrives at `model.completed`; the connection already emits `delta` so p5 changes only the harness side (`model.delta` → `delta` incremental). This plan does not wait for p5 | User (2026-09-16): validate the harness now |

## Proposed architecture

```
packages/chat/                       @facio/chat, bin facio-chat
  package.json  tsconfig.json  tsconfig.test.json  README.md
  src/
    index.ts                         facioHost, FacioHostOptions, loadChatConfig, buildAgent
    config.ts                        ChatConfig, loadChatConfig (file + env), permission modes
    agent.ts                         buildAgent({ config, provider, modelId, permissions, store, workspace }) → Agent
    turns.ts                         projectTurns({ messages, runs, pending }) → Turn[] (+ active, input)
    events.ts                        projectEvent(event, ctx) → HostEvent[]
    questions.ts                     askToQuestion, answersToAsk
    host.ts                          facioHost(options) → HostConnection (core members)
    main.ts                          the program: flags, terminal, registerChat, quit
    turns.test.ts  events.test.ts  questions.test.ts  host.test.ts
packages/agents/src/types/store.ts   UPDATE: Store.sessions.delete
packages/agents/src/store/memory.ts  UPDATE: delete
packages/store-file/src/store.ts     UPDATE: delete (rm -rf the session folder; refuses while writer.lock exists)
packages/agents/src/testing/store-conformance.ts  UPDATE: delete cases
```

- **Data flow.** Store → `projectTurns` → snapshot; `RunHandle.events` → `projectEvent` → observers; UI commands → `run` / `resume().submit` / kv writes.
- **Layer responsibilities.** `@facio/chat` owns the projection and the program; `@textui/chat` owns every screen; `@facio/agents` owns execution and persistence.
- **Import rules.** `host.ts` is the only file that imports `run` / `resume`; `main.ts` the only one that imports `@textui/terminal`.

## Phases

### Task 1 - `Store.sessions.delete`

- **Files:** `UPDATE: packages/agents/src/types/store.ts` (`delete(args: { sessionId: string }): Promise<void>` on `sessions`; `StoreError('writer_busy')` while a writer claim exists, `not_found` when absent), `UPDATE: packages/agents/src/store/memory.ts`, `UPDATE: packages/store-file/src/store.ts` (`rm(dir, { recursive: true })` after the lock check; also clears the session cache entry), `UPDATE: packages/agents/src/testing/store-conformance.ts` (+2 cases: delete removes session, runs and requests; delete while claimed → `writer_busy`).
- **Validation:** conformance suite green on both stores.

### Task 2 - Config and agent factory

- **Files:** `CREATE: packages/chat/{package.json,tsconfig.json,tsconfig.test.json,README.md}`, `CREATE: src/config.ts`, `CREATE: src/agent.ts`, `CREATE: src/questions.ts` + tests, `UPDATE: vitest.workspace.ts` (project `@facio/chat`), `UPDATE: pnpm-workspace.yaml` if needed.
- `config.ts`:
  ```ts
  export interface ProviderConfig { id: string; name?: string; baseUrl: string; apiKey?: string; headers?: Record<string, string> }
  export type PermissionMode = 'ask' | 'destructive' | 'auto';
  export interface ChatConfig {
    providers: ProviderConfig[];
    /** '<providerId>/<modelId>' */
    model?: string;
    permissions: PermissionMode;
    instructions?: string;
    limits?: Partial<Limits>;
  }
  /** ~/.facio/chat.json merged over env: FACIO_BASE_URL (+ FACIO_API_KEY, FACIO_MODEL) adds/overrides a provider 'default'. */
  export async function loadChatConfig(args: { home: string; env?: NodeJS.ProcessEnv }): Promise<ChatConfig>
  ```
  Unknown keys in the file → `AgentError('invalid_options')` naming the key; no providers at all → `invalid_options` with the two ways to add one.
- `agent.ts`: `buildAgent(args)` per decision 3; `policy` by mode: `ask` → `requireApproval: () => true`, `destructive` → default, `auto` → `() => false`; `warn` → stderr.
- `questions.ts`: `askToQuestion(q: AskQuestion): Question`, `answersToAsk(questions, answers: Record<string, Answer>): AskAnswers` (decision 10).
- **Validation:** `config.test.ts` (file + env merge, unknown key, no provider); `questions.test.ts` (both directions, multi-select, freeform).

### Task 3 - Turn and event projection

- **Files:** `CREATE: src/turns.ts`, `src/events.ts` + tests.
- `projectTurns({ messages, runs, requests })`: decision 8; returns `{ turns: Turn[]; active?: Turn; input?: PendingInput; status: number }`.
- `projectEvent(event: RunEvent, ctx: { turn: MutableAgentTurn; requestIdToCall: Map<string, ToolCall> }): HostEvent[]`: decision 9; the ctx accumulates the in-flight agent turn so `turnComplete` carries the full turn.
- **Validation:** `turns.test.ts` with a hand-built transcript (two runs, one awaiting approval): turn count, part order, statuses, `input` present with the right call; `events.test.ts` drives the fake model through `run()` in a memory store and asserts the `HostEvent` sequence `turnStarted, delta, toolCall(pending), toolCall(running), toolCall(completed), delta, turnComplete, status` for the echo script, and `inputNeeded` for a destructive tool.

### Task 4 - `facioHost`

- **Files:** `CREATE: src/host.ts` + `host.test.ts`, `CREATE: src/index.ts`.
- `facioHost(options: { store: Store; providers: ModelProvider[]; config: ChatConfig; workspace: string; home: string }): HostConnection` implementing decisions 2, 4-7, 11-15. Internals: `attached: Map<sessionId, { handle: RunHandle; agent: Agent }>`, `observers: Map<sessionId, Set<observer>>`, `sessionObservers: Set<() => void>`, `queues: Map<sessionId, QueuedMessage[]>`, `models: ModelRow[]` cache filled by `agents()`.
- `subscribe(uri, observer)`: snapshot from `projectTurns` → `observer({ type: 'snapshot', ... , draft })`; if a handle is attached (or lazily attached per decision 15) pipe `projectEvent` over `handle.events` starting after the snapshot's known seq; returns `{ close }` removing the observer only.
- `say(uri, text, model)`: enqueue if a run is attached and not finished; else `buildAgent` → `run({ agent, session: sessionId, workspace, input: text })` → attach → fan-out; on `outcome` settle → detach → `onSessions` → drain queue head.
- **Validation:** `host.test.ts` with the memory store, the fake model and `describeHostConformance({ name: 'facio', create })` from `@textui/chat/fake` (core cases); plus: `listSessions` after one `say` shows one row with `InProgress` then `Idle`; destructive tool → row `InputNeeded`, `confirmToolCall(approved)` → tool runs once → `Idle`; `completeInput` with two answers → the transcript's tool result matches `renderAnswers`; `setRead` / `setArchived` survive a new `facioHost` on the same store; `disposeSession` removes the row; `queue` while running sends after `turnComplete`; a second `facioHost` on the same file store root sees the awaiting session and can approve it (cross-process resume).

### Task 5 - The program

- **Files:** `CREATE: src/main.ts`, `UPDATE: package.json` (`bin: { "facio-chat": "./dist/main.js" }`, `#!/usr/bin/env node`), `CREATE: README.md` (config file, env vars, flags, keys are `@textui/chat`'s).
- `main.ts`: parse flags (decision 16); `loadChatConfig`; providers from config; `createFileStore({ root: home })`; `facioHost(...)`; `createApp` + `createNodeTerminal` as `F:\github\textui\examples\chat\src\main.tsx` does; `registerChat(app, { host, workspace })`; quit on `ctrl+q`; `--static` renders one frame to stdout and exits. Stop the app before exit on every path (the example's rule: never leave the terminal in raw mode).
- **Validation:** manual: LM Studio running → `pnpm --filter @facio/chat dev`: new session, ask the time with a `now`-style tool from config? No tools beyond `ask_user` and skills are configured by default; validation script: (1) `say` "hello" → reply streams whole; (2) `say` "ask me two questions before answering" → the question block, answer, reply; (3) a skill folder under `<workspace>/.agents/skills/demo` shows in the first request (check `steps.jsonl`); (4) quit mid-approval (add a destructive tool via a `--demo-tools` flag that registers `delete_file` with a fake executor), restart, the session shows waiting, approve, completes. `--static --width 100` prints a frame with no server.

### Task 6 - Docs

- `packages/chat/README.md`; `roadmap/plans/cli/00-cli.md` updated; root `README.md` gains the one-paragraph "try it" for `facio-chat`.

## Cross-layer consistency

| Shape | Source | Consumers |
| --- | --- | --- |
| `HostConnection`, `HostEvent`, `Turn`, `PendingInput`, `Question`, `Answer`, `SessionSummary`, `SessionFlag` | `@textui/chat` | `host.ts`, `turns.ts`, `events.ts`, `questions.ts` |
| `RunEvent`, `RunHandle`, `RunOutcome`, `Message`, `RunRecord`, `PendingRequest`, `AskQuestion`, `AskAnswers` | `@facio/agents` | same |
| `ChatConfig`, `PermissionMode` | `packages/chat/src/config.ts` | `agent.ts`, `host.ts`, `main.ts` |

## Risks and tradeoffs

- **Blocked on CHAT-01.** Tasks 1-3 do not import `@textui/chat` types at runtime but do at type level; they can start against a local copy of ahpc's `types.ts` and switch imports when the package exists. Task 4 onward needs the package.
- Whole-text `delta` until p5: the UI's streaming path is exercised only by the fake host until then.
- `link:` dependencies make `pnpm install` in this workspace depend on a sibling checkout; the README says so, and the switch to `^0.6.0` is one line.
- No `lastMessageId`: grouping by `inputMessageId` assumes the loop is the only appender, which the writer fence guarantees.

## Resume state

- **Done so far:** plan written 2026-09-16. Nothing built. Blocked until textui CHAT-01 ships `@textui/chat`.
- **Next action:** Task 1 (`Store.sessions.delete`) can start now; Tasks 2-3 can start against ahpc's `types.ts` shapes; Task 4+ after CHAT-01.
- **Open questions:** none.
- **Watch out for:** p5 decision 95 (steer) changes decision 12 once it ships: `say` during an attached run becomes `handle.submit({ type: 'steer', text })`, falling back to a new `say` on `not_running`; `queue` stays the follow-up queue. `@textui/*` are ESM with `jsx-runtime` sub-paths; `packages/chat/tsconfig.json` needs `"jsx": "react-jsx", "jsxImportSource": "@textui/core"` only if `main.ts` uses JSX (it should not; `registerChat` needs none). The `bin` must not import `vitest`-tainted paths (`@facio/agents/testing/store-conformance` is test-only).

## Final verification checklist

- [ ] `pnpm check` green with the new workspace.
- [ ] `describeHostConformance` core cases pass against `facioHost`.
- [ ] Cross-process approve: pause in one `facioHost`, approve from another on the same root.
- [ ] Manual script of Task 5 done against LM Studio, noted with date.
- [ ] `index.md` updated.
