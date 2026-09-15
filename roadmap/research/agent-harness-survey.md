# Agent harness survey - what the field has

Scope: main features only, grouped by area, with who has each one.
Pure-TS harnesses: pi, OpenClaw, Claude Agent SDK (TS build), Codex app-server clients, Gemini CLI, OpenCode, OpenAI Agents JS, Vercel AI SDK, Mastra, Deep Agents JS / LangGraph.js, elizaOS, VoltAgent, Inngest AgentKit, Cloudflare Agents, Genkit, Copilot SDK, BeeAI, pood, ahpd.
Sources: local checkouts (claude-code, openclaw + `@openclaw/agent-core`, hermes-agent, eliza, ahpd) and public docs for the rest.
This is a catalogue, not a recommendation.

## Harnesses surveyed

| Harness | Language | Shape | Notes |
| --- | --- | --- | --- |
| pi (`@earendil-works/pi-agent-core`, pi-coding-agent) | TS | Minimal core + extension system | 4 built-in tools (read/write/edit/bash), everything else is an extension. OpenClaw's `agent-core` is a fork of it. |
| OpenClaw (`@openclaw/agent-core` + gateway) | TS | Gateway daemon, channels, plugins | Largest plugin/capability surface. Memory tiers, context engine slot, multiple harness runtimes (built-in + Codex). |
| Claude Code / Claude Agent SDK | TS/Py | CLI + in-process library | Same loop as the CLI. Hooks, permissions, subagents, skills, plugins, MCP. |
| Codex (app-server) | Rust | JSON-RPC server, thin clients | threads/turns/items model, approvals as server-initiated requests, sandbox modes, fork/steer/interrupt. |
| Gemini CLI | TS | CLI + headless + ACP | Extensions, hooks, GEMINI.md memory, checkpointing, plan mode, model routing. |
| OpenCode | TS | Client/server + SDK + TUI/desktop/IDE | Plugin event hooks, allow/ask/deny permissions, share/fork/undo sessions, ACP. |
| Goose (Block) | Rust | CLI + desktop | Extensions are MCP servers. Recipes (YAML agent configs), subagents, scheduler. |
| Hermes Agent (Nous) | Py | CLI + messaging gateway | Self-improving loop: skill creation, FTS5 session search, Honcho user model, 7 terminal backends. |
| OpenAI Agents SDK | TS/Py | In-process library | Agents, handoffs, guardrails, sessions, tracing, HITL with state serialization. |
| Vercel AI SDK (ToolLoopAgent) | TS | In-process library | `stopWhen`/`prepareStep` loop control, provider middleware, needsApproval, MCP client. |
| Mastra | TS | In-process framework | Richest built-in memory model (working memory, semantic recall, observational memory, processors). |
| Deep Agents (LangChain/LangGraph) | Py/TS | In-process framework | Middleware stack, pluggable backends (state/fs/store/sandbox), checkpointer durability, interrupts. |
| Pydantic AI | Py | In-process library | Typed deps/output, `agent.iter()` graph stepping, usage limits, Temporal/DBOS durable execution. |
| Google ADK | Py/TS/Go/Java | In-process framework | Workflow agents (sequential/parallel/loop), callbacks, SessionService/MemoryService, artifacts, bidi streaming. |
| Letta | Py/TS | Server, stateful agents | Self-edited memory blocks, archival memory, sleep-time agents, `.af` agent files. |
| elizaOS | TS | Runtime + plugins | Plugin = actions + providers + evaluators + services; character files; multi-agent; connectors. |
| VoltAgent | TS | In-process framework | Dynamic instructions/tools/model per call, hooks, guardrails, supervisor + `delegate_task`, retriever, VoltOps observability. |
| Inngest AgentKit | TS | In-process on Inngest | Agents + Networks with code or agent routers, shared typed state, durable steps, HITL via `waitForEvent`. |
| Cloudflare Agents SDK | TS | Durable Object per agent | Agent = durable identity + SQL + state sync to clients, WS/HTTP/email/RPC entrypoints, `schedule()`/cron, McpAgent server, tool confirmation. |
| Genkit (Google) | TS | In-process library | `ai.generate` loop, `defineTool`, `maxTurns`, `returnToolRequests` manual loop, tool interrupts for HITL, flows, dotprompt, sessions, OTel. |
| GitHub Copilot SDK | TS (+5) | Wraps Copilot CLI over JSON-RPC | Host-defined tools, `onPreToolUse`/`onPermissionRequest`, MCP, sessions resume, BYOK. Same shape as Claude Agent SDK. |
| BeeAI Framework | TS/Py | In-process framework | ReAct / tool-calling / requirement agents with rules, memory strategies (unconstrained/sliding/token/summarize), emitter events, OTel, YAML workflows. |
| LangGraph.js | TS | Graph runtime | Substrate under Deep Agents: checkpointer, interrupts, store, streaming modes, time travel. |
| **doop / pood (yours)** | TS | Daemon, channels, plugins | Think layer (pre-loop control directive), explicit agent state machine, layered budgeted context assembly, KG + intent-typed memory, plans/DAG/flows, A2UI, HITL manager. |
| ahpd (yours) | TS | AHP host | `Agent`/`Session` contracts, ports (resources/terminals/changes/automations), scheduled automations. |

## doop / pood - what it has today (read from `pood/src` and `packages/sdk`)

Loop shape (`pood/src/runtime/agents/agent-worker.ts`, `agent-worker.runtime-types.v4.ts`):

- A turn enters through a **control directive** from the think layer (`packages/sdk/src/think.ts`): `proceed | steer | partial_replan | full_replan | halt`, with `decisionId` and `decisionPolicyVersion` recorded on a `RunSnapshot`.
  `full_replan` and `halt` never enter the loop.
- Explicit **agent state machine** with validated transitions: `idle → observing → thinking → planning → executing → reflecting → waiting_external → learning → paused → failed`, each transition published as `agent:state_changed`.
- Iteration outcomes are a closed union: `tool_batch | final_response | await_user | halt`.
  Loop exit reasons: `completed | max_iterations_reached | budget_exhausted | paused | failed`.
- **Tool effects** returned with every tool result (`mutatedPlan/Memory/Facts/Instructions/Workspace`, `requiresCheckpoint`, `requiresReassemble` with `none|light|full` policy) drive context re-assembly mid-turn.
- Pause signal checked every iteration (operator pause), checkpoint of working memory per iteration (`agent_checkpoints` table), budget check before run and before each iteration with a "conserving mode" notice injected into context.
- Loop guards: diminishing-output streak detection, tool result compaction with preview chars, `maxToolCallsPerTurn`, `maxIterations`.
- Per-session queue (`session-queue.ts`), agent supervisor/roster/router, heartbeat tick.

Tools (`pood/src/engine/tools`, `packages/sdk/src/provider/tool.ts`):

- `ToolManifest`: `permissions`, `rateLimit`, `estimatedTokenCost`, `requiresHumanApproval`, `sandbox: in-process|vm|docker|lambda`, `sequential`, `accessClass: read|write|admin`, `availableWhen` scope tags (`<domain>:<state>`), `surfaces: agent|flow|user-chat`, `inputSchema`.
- Resolution order: kernel tools, agent-bound connector tools, plan/task tools, skill tools (`SkillToolBridge`), workspace FS tools, flow tools, MCP tools (`mcp-tool-adapter`).
- Gating: `tool-access-policy`, `tool-permission`, `tool-rate-limit`, `tool-argument-sanitizer`, `tool-availability-checks`; access class gated by the think layer's plan phase.
- Sandbox runtime registry (in-process, vm), workspace jail for paths.

Hooks (`pood/src/platform/hooks/hook-registry.ts`, `PluginApi.registerHook`):

- Hooks are **observational**: subscribers on bus event types, `void` return, 5 s timeout, circuit breaker after 3 failures.
  There is no intervention hook that can block or rewrite a tool call; gating lives in policy modules instead.

Plugins (`packages/sdk/src/plugin.ts`):

- `registerChannel`, `registerConnector`, `registerModel`, `registerMemory`, `registerEmbedding`, `registerReranker`, `registerWebSearch`, `registerTool`, `registerApiRoute`, `registerCliCommand`, `registerService`, `registerJob`, `registerHook`.
  32 plugins in tree (models, channels, connectors, memory, search, mcp-client).

Context assembly (`pood/src/brain/knowledge/context-assembler.ts`):

- Blocks collected then `fitToBudget()` runs one deterministic degradation pass; per-layer budget shares (`systemPromptShare`, `workingMemoryShare`, `semanticMemoryShare`, `workspaceShare`) from agent runtime settings.
- Layers: system prompt + persona, explicit skills (protected), agent self-knowledge facts, workspace folders + facts, injected payload items (heartbeat, system events), 5-stage memory pipeline with timeout, KG beliefs scoped to contact, cognitive skill signals, flow handoff context, steering message, think-skill hints, execution skill instructions, instruction injections, plan/task graph, working memory (replaces raw history), current user message.
- Governance meta accumulated per block for audit; `memory:context_composed` event with token breakdown.

Memory (`packages/sdk/src/provider/memory.ts`, `pood/src/brain/knowledge`):

- Entries typed by `namespace: agent|workspace`, `context: contact|session`, `intent: contextual|personal|factual|procedural`, with `MemorySource`/`MemoryOrigin` provenance.
- Knowledge graph facts: subject types (`contact|workspace|agent|concept|product|thing`), predicate definitions with cardinality, source (`tool|auto_extracted|user_confirmed|system`), visibility (`private|workspace|global`), per-agent KG repository, shared `knowledge.db`.
- Retrieval fusion + reranker registry, short-term scoring, conflict heuristics, retention helpers, chunking, memory policy resolver, block limits.
- Working memory snapshot per checkpoint; compaction manager on sessions; memory profiles and scopes in `packages/settings/src/memory`.

Skills (`pood/src/brain/skills`): catalog, installer, loader, compiler, embedder, ranker, retriever, resolver, activator, enricher, requirements, pending/error stores, tool bridge.
Skills are ranked and activated per turn, not only loaded by name.

Instructions (`pood/src/brain/instructions`): per-agent instruction files with parser, registry, resolver, trigger registry, and tools so the agent can edit its own instructions.

Planning and orchestration (`pood/src/runtime/plans`, `dag`, `flows`, `tasks`): plan state machine + task state machine + node state machine, plan compiler and constraints, DAG executor with mutation validator and cancellation token, flow orchestrator/runtime with schema, job manager and task queue with leases and retries.

Safety (`pood/src/platform/safety`): agent policy engine, injection scanner, output filters, exfiltration block, workspace jail, security auditor/fixer, vault for secrets.
HITL manager with approval requests and structured question requests (`ask-user-tool`), finalized-decision events.

Multi-agent (`pood/src/runtime/agents/tools`): `handoff-agent`, `await-agents`, sub-agent spawn/complete events, teams, contacts and rooms.

Automation: cron manager with delivery service, heartbeat, job manager, webhook channel.

Events (`packages/sdk/src/events.ts`): 123 typed event types across agent, HITL, tool, session, terminal, workspace, security, sandbox, channel, chat, team, DAG, bus DLQ.
Event bus has DLQ replay and handler retry scheduling.

UI: A2UI manager with component/surface registry, form bus, `push-to-canvas` tool; s2ui protocol in `packages/s2ui`.

Transport: HTTP routes + Socket.IO bridges, CLI client, web and web-next frontends, terminals engine.

Not present as first-class today (relative to the spec and the field):

- A run handle with stable run ID exposed to the host (runs are keyed by session; `traceId` and `decisionId` exist).
- Event sequence numbers per run for replay.
- Intervention hooks (`beforeModel`, `beforeTool` with block/modify decisions).
- Session fork / tree; rewind.
- Stable tool invocation IDs for idempotent recovery.
- Model adapter capability reporting as a contract (`ModelProvider` in `packages/sdk/src/provider/model.ts` has no features field).

## Feature catalogue

Legend: "most" = present in nearly all; names listed when it is a differentiator.

### 1. Core loop

| Feature | Who has it |
| --- | --- |
| Agent definition = instructions + model + tools + limits | all |
| Explicit run/turn/step model with stable IDs | Codex (thread/turn/item), OpenClaw (`runId`, agent/turn/message events), Claude SDK, OpenAI SDK (RunResult), ahpd (turn); pood has `traceId` + `decisionId` + iteration, no run ID |
| Step / iteration limit | all libraries; Hermes `iteration_budget`; Pydantic usage limits (tokens, requests, tool calls, cost); pood `maxIterations` + `maxToolCallsPerTurn` + token budgets with conserving mode; Genkit `maxTurns`; AgentKit `maxIter` |
| Serial vs parallel tool execution as a switch | pi/OpenClaw `ToolExecutionMode = "sequential" \| "parallel"`, Claude Code (batches), Codex |
| Loop control callbacks (`stopWhen`, `prepareStep`, `shouldStopAfterTurn`, `prepareNextTurn`) | Vercel AI SDK, OpenClaw agent-core, Pydantic `agent.iter()` node stepping, Genkit `returnToolRequests` (manual loop), pood `buildIterationOverlay` + tool effects that force re-assembly |
| Streaming text + tool-call fragments; assemble before execute | all |
| Cancellation propagated to model + tool (AbortSignal) | all; OpenClaw `turn-interruption`, Codex `turn/interrupt` |
| Steering: inject a message into a running turn | Codex `turn/steer`, OpenClaw queue modes (steer/followup/collect/interrupt), Claude Code queued messages, pi `pi.sendUserMessage`, pood think-layer `steer` directive + steering block in context |
| Queue modes per session (one-at-a-time / all) | OpenClaw `QueueMode`, Hermes |
| Structured output (typed) | OpenAI SDK, Vercel, Mastra, Pydantic, ADK, Claude SDK |
| Thinking/reasoning level as a first-class setting | pi, OpenClaw (`ThinkingLevel`), Claude Code (`/effort`), Codex |
| Retry with model-visible feedback (`ModelRetry`) | Pydantic AI |
| Pre-loop decision layer (classify the turn before the model loop: proceed / steer / replan / halt) | pood think layer |
| Explicit agent state machine with validated transitions | pood |
| Tool results carry effects that trigger context re-assembly / checkpoint | pood `ToolEffects` |
| Deterministic fake model for tests | pi, OpenClaw, Vercel (MockLanguageModel), Pydantic (TestModel) |

### 2. Model layer

| Feature | Who has it |
| --- | --- |
| Multi-provider abstraction (Anthropic, OpenAI, Google, Bedrock, Azure, OpenRouter, local) | all |
| Provider registration via plugin (`registerProvider`) | pi, OpenClaw, Vercel (custom provider) |
| Capability reporting per model (tools, streaming, images, reasoning) | pi-ai model registry, OpenClaw, Vercel |
| Model routing / fallback / failover | OpenClaw `model-failover`, Gemini CLI model routing, Hermes profile routing, Vercel AI Gateway |
| Request/response interception (headers, payload rewrite) | pi `before_provider_headers/request`, Vercel `wrapLanguageModel` middleware, OpenClaw `extra-params` |
| Prompt caching awareness | Claude Code, Deep Agents, Hermes `prompt_caching`, OpenClaw |
| Usage + cost accounting per run/session | Claude Code `cost-tracker`, OpenClaw `usage-tracking`, Hermes `credits_tracker`, OpenAI SDK, Pydantic |
| Auth profiles / OAuth for providers, credential pool rotation | OpenClaw (per-agent auth SQLite), Hermes `credential_pool`, Codex, Claude Code |
| CLI-backend inference (drive another coding CLI as the model) | OpenClaw `registerCliBackend`, Hermes `codex_runtime` / `copilot_acp_client` |

### 3. Tools

| Feature | Who has it |
| --- | --- |
| Built-in file/shell tools (read, write, edit, bash/exec, glob, grep) | all coding harnesses |
| Built-in web (search, fetch), browser | Claude Code, OpenClaw, Hermes, Gemini CLI, Codex |
| Tool registry with schema validation at runtime | all |
| Effect / risk metadata on tools (read-only, destructive, network) | MCP annotations; OpenClaw tool policy groups; Claude Code permission classifier; Codex approval types; pood `ToolManifest` (`accessClass`, `sandbox`, `sequential`, `requiresHumanApproval`, `estimatedTokenCost`, `rateLimit`) |
| Tool allow/deny policy separate from permission prompt | OpenClaw (profile + allow/deny + provider + sandbox + channel), OpenCode allow/ask/deny rules, Claude Code settings rules, pood `tool-access-policy` + `availableWhen` scopes + `surfaces` |
| Tool progress streaming (`tool_execution_update`) | pi/OpenClaw, Claude Code, Codex items |
| Tool search / deferred tool loading (large catalogs) | Claude Code `ToolSearchTool`, OpenClaw `tool_search`, Codex native tool search |
| Code mode (model writes a script that calls tools) | OpenClaw `tools.codeMode`, Hermes (Python RPC scripts), Codex |
| Agent-as-tool / delegate tool | OpenAI SDK, ADK, Pydantic, Goose, Hermes `delegate_tool`, Claude Code `AgentTool` |
| Provider-executed / hosted tools (web search, code interpreter) | OpenAI SDK, Vercel, ADK, Claude Code |
| MCP client: tools | all except pi core (extension) |
| MCP client: resources, prompts, elicitation, OAuth | Claude Code (`ListMcpResources`, `McpAuth`, `Elicitation` hook), Codex, Hermes (`mcp_oauth_manager`), Goose |
| MCP server (expose the harness as MCP) | Claude Code, OpenClaw (`tools-invoke-http-api`) |
| Ask-user / clarify tool (structured question to human) | Claude Code `AskUserQuestion`, OpenClaw `ask_user`, Hermes `clarify_tool` |
| Secrets tool (model obtains credential without seeing it) | OpenClaw `secrets` |
| Terminal/execution backends (local, docker, ssh, cloud sandbox) | Hermes (7 backends), OpenClaw sandboxing, Deep Agents sandbox backend, Codex `externalSandbox` |
| Tool result size bounding + spill to file | Hermes `hook_output_spill`, OpenClaw `tokenjuice`, Claude Code |
| Custom tool result renderers (UI) | pi `registerTool` render, OpenClaw TUI renderers, Codex items |

### 4. Permissions and approval

| Feature | Who has it |
| --- | --- |
| Permission modes (plan / auto / manual / bypass) | Claude Code, Gemini CLI (plan mode, trust), OpenCode (build/plan), Goose modes (auto/approve/chat/smart) |
| Sandbox modes (read-only / workspace-write / full / external) | Codex, Claude Code, OpenClaw, Gemini CLI |
| Approval as a durable pause with request ID; resume from another observer | Codex (server-initiated JSON-RPC request), OpenAI SDK (interruptions + state serialization), Deep Agents (LangGraph interrupt + checkpointer), Pydantic `DeferredToolRequests`, Vercel `needsApproval`, ahpd (AHP approvals) |
| Approval decision vocabulary beyond yes/no (amend policy, always allow, cancel) | Codex, Claude Code (`PermissionRequest` hook), OpenClaw exec approvals |
| Guardrails (input / output / tool tripwires) | OpenAI SDK, Mastra processors, ADK callbacks, VoltAgent, BeeAI requirement rules, pood (injection scanner, output filters, exfiltration block) |
| Project trust gate | pi `project_trust`, Gemini CLI trusted folders, Claude Code |
| Auto-permission classifier (LLM judges risk) | Claude Code (YOLO classifier), Goose smart approve |
| Final authorization enforced by runtime, not hook | Codex, Claude Code; spec requirement |

### 5. Hooks and extension points

| Feature | Who has it |
| --- | --- |
| Typed in-process lifecycle hooks (before/after model, before/after tool, compaction, session) | pi (30+ events), OpenClaw plugin hooks, Claude SDK (30+ events), OpenAI SDK lifecycle, ADK callbacks, Vercel callbacks, VoltAgent (`onStart/onEnd/onToolStart/onToolEnd/onHandoff/onPrepareMessages`), AgentKit (`onStart/onResponse/onFinish`), Copilot SDK (`onPreToolUse`, `onPermissionRequest`); pood hooks are observe-only bus subscribers |
| Hook decisions are explicit (`block`, modified args, transformed result) | pi `tool_call` (block + mutate), OpenClaw `before_tool_call {block}`, Claude `PreToolUse` (allow/deny/modify), OpenClaw `tool_result_persist` (transform before write) |
| Script hooks from config (`settings.json`, `HOOK.md`) | Claude Code, Gemini CLI, OpenClaw internal hooks, Codex |
| Async / non-blocking hooks | Claude SDK (`async: true`) |
| Plugin manifest with capability registration (providers, channels, speech, embeddings, web search, image gen) | OpenClaw (14 capability kinds), eliza (actions/providers/evaluators/services), Gemini extensions, pood (13 `register*` kinds incl. memory, embedding, reranker, web search, api route, cli command, service, job) |
| Plugin bundles: skills + agents + hooks + MCP servers in one package | Claude Code plugins, Codex plugins, OpenClaw bundles, Gemini extensions |
| Plugin marketplace / hub | Claude Code marketplaces, Codex, OpenClaw ClawHub, Hermes Skills Hub, eliza registry, Goose |
| Slash commands / custom commands registered by extensions | pi, Claude Code, Gemini CLI, OpenCode, OpenClaw |
| Extension UI injection (status, widgets, dialogs, custom renderers) | pi `ctx.ui.*`, OpenClaw `show_widget`, Claude Code |
| Server-driven UI emitted by the agent (A2UI / generative UI) | pood A2UI + s2ui, Cloudflare state sync to clients |
| Dynamic instructions / tools / model resolved per call from context | VoltAgent, AgentKit, Mastra, pood (settings layers + think layer) |
| Extension persistent entries in the session (non-LLM data) | pi `appendEntry`, OpenClaw custom messages |
| Pluggable context engine slot (replace assembly + compaction) | OpenClaw `plugins.slots.contextEngine` |
| Pluggable harness runtime slot (swap the whole loop) | OpenClaw harness registry (`openclaw`, `codex`) |
| Self-modifying harness (agent edits its own extensions) | Letta mods, Hermes self-learning |

### 6. Context assembly and compaction

| Feature | Who has it |
| --- | --- |
| Instruction files loaded into system prompt (AGENTS.md / CLAUDE.md / GEMINI.md / SOUL.md) | all coding harnesses; OpenClaw SOUL.md; Hermes context files |
| Skills (SKILL.md, progressive disclosure, agentskills.io standard) | Claude Code, pi, OpenClaw, Hermes, Codex (`$skill`), Gemini, OpenCode, Deep Agents, Letta |
| Canonical transcript separate from derived model view (`transformContext` + `convertToLlm`) | pi/OpenClaw agent-core, Deep Agents, Mastra processors, pood (working memory replaces raw history; blocks + `fitToBudget`) |
| Auto compaction at threshold, manual `/compact`, micro-compaction | Claude Code (auto/micro/API), OpenClaw, pi, Hermes `micro-compaction`, Codex, OpenCode |
| Compaction hooks (before/after, custom summarizer, veto) | pi `session_before_compact` (can veto + replace), Claude `PreCompact/PostCompact`, OpenClaw observe-only, OpenCode `experimental.session.compacting` |
| Context pruning of old tool results (keep transcript intact) | OpenClaw `context pruning` hook, Mastra tool call filter, Hermes |
| Summaries carry provenance, replaceable | OpenClaw memory provenance, spec requirement |
| Compaction reserve tokens per model | OpenClaw, Claude Code `tokenBudget` |
| Context usage inspection (`/context`, `getContextUsage`) | Claude Code, pi, Hermes `context_breakdown` |
| Post-tool-batch injection point | Claude SDK `PostToolBatch` |

### 7. Memory

| Feature | Who has it |
| --- | --- |
| Human-authored instruction memory (file, always injected) | all |
| Agent-curated memory files (MEMORY.md, USER.md) with types (user/feedback/project/reference) | Claude Code `memdir`, OpenClaw curated core, Hermes |
| Episodic daily notes, never injected, searchable | OpenClaw `memory/YYYY-MM-DD.md` |
| Session/transcript search (FTS) | Hermes FTS5 session search, OpenClaw session search, Claude Code |
| Semantic recall (vector, topK, message range) | Mastra, OpenClaw memory-lancedb / qmd, Letta archival, eliza RAG, VoltAgent retriever, pood (retrieval fusion + reranker) |
| Working memory (schema or markdown, thread vs resource scope) | Mastra |
| Self-edited memory blocks with tools (`core_memory_replace`) | Letta |
| Background consolidation pass ("dreaming", observational memory, sleep-time agent) | OpenClaw dreaming, Mastra observational memory, Letta sleep-time, Hermes curator |
| Memory provenance / trust tiers, write-path as security boundary | OpenClaw |
| User model (dialectic) | Hermes + OpenClaw via Honcho |
| Standing intents / prospective memory (fires on trigger) | OpenClaw |
| Memory as a pluggable provider (`memory_provider`) | Hermes, OpenClaw plugins, Mastra storage adapters, ADK MemoryService, VoltAgent Memory adapters, BeeAI memory strategies, pood `registerMemory` |
| Knowledge graph facts with predicates, cardinality, visibility, source | pood; OpenClaw memory-wiki (adjacent) |
| Memory entries typed by intent (contextual / personal / factual / procedural) and scope | pood |
| Memory age / relevance scoring for injection | Claude Code `memoryAge`, `findRelevantMemories` |
| Team-shared memory | Claude Code `teamMemPaths` |

### 8. Sessions and persistence

| Feature | Who has it |
| --- | --- |
| Durable transcript (JSONL or SQLite) with typed entries | all coding harnesses; pi JSONL tree, OpenClaw SQLite, Codex, pood SQLite (Drizzle), Cloudflare (Durable Object SQL) |
| Resume by ID | all |
| Fork from a turn / branch tree without duplication | pi (session tree), Codex `thread/fork`, Claude Code `--fork`, OpenCode fork, ahpd `forkPoint` |
| Rewind / revert / undo | OpenCode undo, Gemini checkpoint restore, Claude Code file history, ahpd `endPoint` |
| File checkpointing (snapshot workspace before tool) | Gemini CLI, Hermes `checkpoint_manager`, Claude Code file history |
| Writer claim / fence so a superseded run cannot commit | OpenClaw `activeWriterRunId` |
| Event sequence numbers + replay for reconnecting observers | Codex, ahpd/AHP, OpenClaw gateway |
| State serialization for HITL across process restart | OpenAI SDK, Deep Agents checkpointer, Pydantic + Temporal/DBOS, AgentKit (Inngest steps + `waitForEvent`), Cloudflare Agents (Durable Object), Genkit interrupts, pood (per-iteration checkpoint + HITL manager, paused state) |
| Session share (public link) | OpenCode, Claude Code |
| Session export / portable agent file | Letta `.af`, Hermes `hermes_state_portability`, Claude Code `/export` |
| Session naming, labels, bookmarks | pi `setSessionName`, `setLabel` |
| Multi-directory sessions, worktrees | Claude Code (`EnterWorktree`, `add-dir`), OpenClaw managed worktrees, ahpd `multipleDirectories` |

### 9. Multi-agent

| Feature | Who has it |
| --- | --- |
| Subagents with isolated context, results summarized back | Claude Code `AgentTool`, OpenClaw subagents, Hermes delegate, Goose, Deep Agents `task`, Gemini |
| Handoffs (transfer the conversation) | OpenAI SDK |
| Workflow agents (sequential / parallel / loop) | ADK, Mastra workflows, Deep Agents graphs, AgentKit Networks + routers, BeeAI YAML workflows, pood plans / DAG / flows |
| Teams / swarm / mailbox messaging between agents | Claude Code (`TeamCreate`, `SendMessage`), OpenClaw swarm + `agent-send`, Letta inter-agent, eliza |
| Parallel specialist lanes | OpenClaw |
| External agents via ACP (Agent Client Protocol) | OpenClaw `acp-agents`, Gemini CLI, OpenCode, Hermes `acp_adapter` |
| A2A protocol | OpenClaw extension |
| Background / async agent tasks with output polling | Claude Code (`TaskOutput`, `TaskStop`), Hermes `async_delegation`, OpenClaw `agents_wait` |

### 10. Automation

| Feature | Who has it |
| --- | --- |
| Cron / scheduled runs delivering to a channel | OpenClaw cron, Hermes cron, Claude Code (`CronCreate`, routines), Goose scheduler, ahpd `scheduledAutomations`, pood cron manager + delivery, Cloudflare `schedule()`/cron |
| Heartbeat / proactive wakeups | OpenClaw heartbeat, Claude Code `Sleep`/`ScheduleWakeup` |
| Webhooks trigger a run | OpenClaw, Claude Code `RemoteTrigger` |
| Goals / standing intents | OpenClaw `goal` tool + standing intents |
| Recipes (shareable agent config with params, retries, sub-recipes) | Goose recipes, eliza character files, Claude Code agents/skills |
| Loop / self-paced repeats | Claude Code `/loop` |

### 11. Host and transport

| Feature | Who has it |
| --- | --- |
| In-process library (host owns the loop) | OpenAI SDK, Vercel, Mastra, Deep Agents, Pydantic, ADK, pi core, Claude SDK |
| Server with thin clients, many observers per session | Codex app-server (JSON-RPC over stdio/WS/unix), OpenClaw gateway (WS), OpenCode server, ahpd (AHP WS), Letta |
| Headless / print / JSON output modes | Claude Code `-p`, pi `--mode rpc/json/print`, Gemini headless, Codex exec |
| Messaging channels (WhatsApp, Telegram, Slack, Discord...) | OpenClaw (40+), Hermes, eliza, Letta, pood (9 channel plugins), Cloudflare (chat/email/webhook) |
| Speaks a standard agent protocol | ahpd (AHP), OpenClaw/Gemini/OpenCode/Hermes (ACP), OpenClaw (A2A), Codex (own JSON-RPC) |
| Device nodes / companion apps | OpenClaw |
| Openai-compatible HTTP API in front of the harness | OpenClaw `openai-http-api`, `openresponses-http-api` |

### 12. Observability and safety

| Feature | Who has it |
| --- | --- |
| Typed event stream with lifecycle phases | all |
| Tracing (OTel / spans) | OpenAI SDK, Pydantic (Logfire), OpenClaw (OTel, Prometheus), Vercel telemetry, Mastra |
| Audit log of tool calls and decisions | OpenClaw `audit`, Claude SDK hooks, Codex |
| Doctor / health diagnostics | Claude Code, OpenClaw, Hermes, Gemini |
| Loop detection (repeated tool calls) | OpenClaw `loop-detection`, Claude Code |
| Trajectory export for training / eval | Hermes batch runner, OpenClaw trajectory |
| Evals / scorers built in | Mastra, ADK, Pydantic evals, OpenAI evals |
| Timeouts and budgets (time, tokens, cost) enforced by runtime | Pydantic usage limits, OpenClaw run timeout, Hermes `budget_config`, Claude SDK `maxTurns`/budget |
| Idempotent tool invocation / uncertain-invocation recovery | not a first-class feature anywhere surveyed; spec requirement |

## Compact matrix

Rows are areas, cells are how deep each harness goes (blank = absent, `·` = basic, `••` = solid, `•••` = differentiating).

| Area | pi | OpenClaw | Claude Code/SDK | Codex | Gemini CLI | OpenCode | Goose | Hermes | OpenAI SDK | Vercel | Mastra | Deep Agents | Pydantic | ADK | Letta | VoltAgent | AgentKit | CF Agents | Genkit | Copilot SDK | BeeAI | pood |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Core loop control | ••• | ••• | •• | •• | •• | •• | • | •• | •• | ••• | •• | •• | ••• | •• | •• | •• | •• | • | •• | • | •• | ••• |
| Model layer | ••• | ••• | • | • | •• | •• | •• | ••• | •• | ••• | •• | •• | •• | •• | • | •• | •• | •• | •• | • | •• | •• |
| Built-in tools | • | ••• | ••• | •• | •• | •• | •• | ••• | • | | • | •• | | • | • | • | | •• | | ••• | • | •• |
| MCP | ext | ••• | ••• | ••• | ••• | •• | ••• | ••• | •• | •• | •• | •• | •• | •• | •• | •• | •• | ••• | •• | •• | •• | •• |
| Permissions / approval | •• | ••• | ••• | ••• | •• | •• | •• | •• | •• | • | • | •• | •• | • | • | • | • | •• | •• | •• | • | •• |
| Hooks | ••• | ••• | ••• | •• | •• | •• | • | •• | •• | • | •• | ••• | • | •• | • | •• | • | • | • | •• | • | • |
| Plugins / capability registry | •• | ••• | •• | •• | •• | •• | •• (MCP) | •• | | | | | | • | •• | | | | •• | | | ••• |
| Context / compaction | •• | ••• | ••• | •• | •• | •• | •• | ••• | • | • | •• | •• | • | •• | •• | • | • | • | • | •• | •• | ••• |
| Memory | ext | ••• | •• | • | • | • | • | ••• | • | | ••• | •• | | •• | ••• | •• | • | •• | • | | •• | ••• |
| Sessions / durability | ••• | ••• | •• | ••• | •• | •• | • | •• | •• | • | •• | ••• | ••• | •• | ••• | • | ••• | ••• | •• | •• | • | •• |
| Multi-agent | ext | ••• | ••• | •• | •• | •• | •• | •• | ••• | • | •• | •• | •• | ••• | •• | •• | ••• | • | • | •• | •• | •• |
| Automation | | ••• | •• | • | | | •• | •• | | | | | | | •• | | •• | ••• | | | | •• |
| Server / observers | rpc | ••• | • | ••• | • | •• | • | •• | | | • | • | | • | ••• | | • | ••• | | •• | | •• |
| Observability | • | ••• | •• | •• | • | • | • | •• | ••• | •• | •• | •• | ••• | •• | • | •• | •• | •• | •• | • | •• | •• |

## Observations (facts, not a design)

Table stakes, present in essentially every harness:
agent definition, multi-provider model adapter, streaming, tool registry with schema validation, MCP tools, step limit, cancellation, durable session with resume, instruction file, some form of pre/post tool hook, subagent.

Where harnesses actually differ:

1. Where the loop lives.
   In-process libraries (OpenAI, Vercel, Mastra, Pydantic, ADK) vs server-with-observers (Codex, OpenClaw, OpenCode, Letta, ahpd).
   Only the server group has run IDs, sequence numbers, and approvals that survive the client that asked.
2. Hooks vs plugins vs capability registry.
   pi and Claude expose a large flat hook list.
   OpenClaw goes further and makes context engine and harness runtime themselves plugin slots.
   eliza's plugin shape (actions / providers / evaluators / services) is the other established pattern.
3. Memory depth.
   Most coding harnesses stop at instruction files plus a curated MEMORY.md.
   OpenClaw, Mastra, Letta, Hermes have real tiers: episodic notes, semantic recall, working memory, background consolidation, provenance.
4. Session shape.
   Linear log (most) vs tree with branching (pi, Codex fork, ahpd forkPoint/endPoint).
5. Approval durability.
   Vercel/ADK: approval is an in-memory callback.
   OpenAI SDK / Deep Agents / Pydantic / Codex: approval is serialized state that can be resumed later, by a different party.
6. pood's distinct contributions versus the field: the think layer (a decision before the loop), the explicit agent state machine, tool effects that drive re-assembly, intent-typed memory plus a predicate knowledge graph, and layered budget shares with one deterministic fit pass.
   Its gaps versus the spec are listed in the pood section above (run handle, sequence numbers, intervention hooks, fork/rewind, invocation IDs, model capability reporting).
7. Two things the spec asks for that no surveyed harness has as a first-class feature: stable invocation IDs for idempotent tools, and explicit "uncertain invocation" recovery after a crash.
   OpenClaw's writer fence is the closest analogue on the transcript side.

## Sources

Local (opendoop checkout): `pood/src/{runtime/agents,engine/tools,brain/knowledge,brain/skills,platform/hooks,platform/safety}`, `packages/sdk/src/{think,plugin,events,provider/*}.ts`, `packages/settings/src/agents`; `f:/github/claude-code/src/tools`, `src/memdir`, `src/hooks`; `f:/github/openclaw/docs/**` and `packages/agent-core/src/types.ts`; `f:/github/hermes-agent/agent`, `tools`; `f:/github/eliza/packages/core/src/types/plugin.ts`; `f:/github/ahpd/packages/sdk/src/types/{agent,session}.ts`.

Web:
- pi: https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/ and https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview and https://code.claude.com/docs/en/agent-sdk/hooks
- OpenAI Agents SDK: https://openai.github.io/openai-agents-js/guides/agents/
- Vercel AI SDK: https://ai-sdk.dev/docs/agents/overview
- Mastra: https://mastra.ai/docs/agents/overview and https://mastra.ai/docs/memory/overview
- Deep Agents: https://docs.langchain.com/oss/python/deepagents/overview
- Pydantic AI: https://pydantic.dev/docs/ai/core-concepts/agent/
- Google ADK: https://adk.dev/
- Codex app-server: https://learn.chatgpt.com/docs/app-server
- Gemini CLI: https://github.com/google-gemini/gemini-cli/blob/main/docs/index.md
- OpenCode: https://opencode.ai/docs/ and https://opencode.ai/docs/plugins/
- Goose: https://github.com/block/goose/discussions/4389 and https://academy.kspl.tech/blog/ai-tool-deep-dive-goose
- Letta: https://docs.letta.com/concepts/letta
- VoltAgent: https://voltagent.dev/docs/agents/overview/
- Inngest AgentKit: https://agentkit.inngest.com/overview
- Cloudflare Agents: https://developers.cloudflare.com/agents/
- Genkit: https://genkit.dev/docs/tool-calling/
- GitHub Copilot SDK: https://github.com/github/copilot-sdk
- BeeAI: https://framework.beeai.dev/introduction/welcome
