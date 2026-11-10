---
title: copapo serves ACP
domain: cli
status: active
priority: high
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/cli/20261110-0407-papo-becomes-copapo/plan.md
refs:
  - git://b83e428 - the last commit that holds the brief `briefs/copapo-and-acp.md`, which this plan covers; its facts were checked at git://ee48196
  - "[code://packages/copapo/src/types/chat.ts#L127-L203](../../../../packages/copapo/src/types/chat.ts#L127-L203) - `Chat`, the service the ACP server maps"
  - "[code://packages/copapo/src/types/turn.ts#L8-L87](../../../../packages/copapo/src/types/turn.ts#L8-L87) - `Snapshot`, `Turn` and `TurnPart`, which the server projects into session updates"
  - "[code://packages/copapo/src/turns.ts#L117-L153](../../../../packages/copapo/src/turns.ts#L117-L153) - the parts of a turn, and the draft as the last text part"
  - "[code://packages/copapo/src/questions.ts](../../../../packages/copapo/src/questions.ts) - the question form and its answers, which elicitation mirrors"
  - "[code://packages/copapo/src/commands.ts#L120-L136](../../../../packages/copapo/src/commands.ts#L120-L136) - `openPapo`, which builds one `Chat` for one workspace"
  - "[code://packages/copapo/src/commands.ts#L526-L538](../../../../packages/copapo/src/commands.ts#L526-L538) - the `chat` command, the pattern for a command that holds the process"
  - "[code://packages/copapo/src/commands/runtime.ts#L147-L160](../../../../packages/copapo/src/commands/runtime.ts#L147-L160) - `/context`, the context fill that `usage_update` reports"
  - "[code://packages/mcp/src/stdio.ts#L24-L80](../../../../packages/mcp/src/stdio.ts#L24-L80) - the stdio JSON-RPC loop with no dependency, whose framing the ACP peer copies"
  - "[code://packages/agents/src/types/store.ts#L195-L201](../../../../packages/agents/src/types/store.ts#L195-L201) - `sessions.fork`"
  - "[code://packages/copapo/src/types/claude.ts#L55-L61](../../../../packages/copapo/src/types/claude.ts#L55-L61) - `ClaudeSdkSubset`, which gains `forkSession`"
  - npm://@agentclientprotocol/sdk@^1.8.0 - the protocol's types and `ClientSideConnection`, for the contract test only
  - https://agentclientprotocol.com - the Agent Client Protocol, protocol version 1
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-acp/src/session/config.ts - how ahpd reads modes and config options
---

## Goal

`copapo acp` is an ACP agent on stdin and stdout, so that ahpd, or any ACP client, runs copapo as it runs Gemini or OpenCode.
Both backends run over it: `copapo acp` and `copapo --backend claude acp`.

## Reconnaissance

### Searches performed

- The ACP SDK 1.8.0 `AGENT_METHODS`, `CLIENT_METHODS` and `types.gen.d.ts` in ahpd's `node_modules` - the methods and the shapes below.
- `rg "connection\.\w+" ../ahpd/packages/agent-acp/src` - agent-acp calls `initialize`, `authenticate`, `session/new`, `load`, `list`, `resume`, `fork`, `close`, `prompt`, `cancel`, `set_mode`, `set_config_option`.
- agent-acp `session/turn.ts` - it holds a message typed during a turn and sends it after the turn ends.
- agent-acp `session/config.ts` - it reads the model from the config option of category `model`, and the modes from `modes`.
- `rg "forkSession" packages/copapo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - the SDK has `forkSession(sessionId)`.

### Runtime path

```
client --session/prompt--> AcpServer -> chatFor(cwd).say -> subscribe -> snapshot -> project -> session/update
                                                            pending -> session/request_permission | elicitation/create -> approve | deny | answer
                                     <- { stopReason } <- wait() settles
```

### Gaps

- `Chat` has no `fork` and no way to read the context fill.
- copapo has no ACP code and no peer that sends requests to its client.

## Answers

| What | Source | Task |
| --- | --- | --- |
| copapo runs as an ACP agent, for ahpd | Softov, 2026-11-09: "add support to acp in it. So we can run it on acp from ahpd" | 02 |
| The server is a `copapo acp` command in the copapo package | Softov, 2026-11-09, asked where it lives: "`copapo acp` command" | 02 |
| It is written with no runtime dependency, as `@cofold/mcp/stdio` is | the brief, and the zero-dependency rule in `CLAUDE.md` | 02 |
| It serves every session method, `session/fork` too, and `Chat` gains `fork` on both backends | Softov, 2026-11-09, asked which methods: "All, fork included" | 01, 02, 04 |
| It serves `session/delete` | Softov, 2026-11-10, asked about delete: "Serve it" | 02 |
| A `session/prompt` during a turn steers its text into that turn | Softov, 2026-11-09, asked what a busy prompt does: "Steer it into the turn" | 03 |
| It sends the slash commands as `available_commands_update` | Softov, 2026-11-09: "Send the list" | 04 |
| The contract test drives `copapo acp` with `@agentclientprotocol/sdk`, a devDependency | Softov, 2026-11-10, asked how ACP is tested: "Official SDK as devDependency" | 05 |
| copapo runs its own tools and never calls the client's `fs/*` or `terminal/*` | the brief | 03 |
| A waiting tool call becomes `session/request_permission`; a question becomes `elicitation/create` | the brief | 03 |
| The permission mode is the ACP session mode; the model and the thinking level are config options of category `model` and `thought_level` | the brief, and agent-acp `session/config.ts` | 04 |
| A session's `cwd` picks its `Chat`: one `Chat` per `cwd`, built as `openCopapo` builds one, kept for the life of the process | (defaulted: a `Chat` is bound to one workspace) | 02 |
| The JSON-RPC peer is copapo's own, with the framing of `@cofold/mcp/stdio` | (defaulted: the MCP loop only answers, and ACP also sends requests to the client) | 02 |
| `initialize` offers no auth method, and `authenticate` answers `{}` | (defaulted: copapo's keys are in its config) | 02 |
| `mcpServers` from the client are not connected; `mcpCapabilities` is not advertised | (defaulted: cofold has no MCP client yet) | 02 |
| `additionalDirectories` are ignored | (defaulted: copapo has one workspace per session) | 02 |
| A prompt's text blocks and `resource_link` URIs become the turn's text; `promptCapabilities` offers no image, audio or embedded context | (defaulted: `Chat.say` takes text) | 03 |
| Text and reasoning stream by their place in the turn, so the draft and the stored message are one chunk stream | [code://packages/copapo/src/turns.ts#L149-L153](../../../../packages/copapo/src/turns.ts#L149-L153) | 03 |
| A tool's kind comes from its name, for the cofold tools and Claude Code's | (defaulted: neither backend declares an ACP kind) | 03 |
| A question goes to the client only when it declares `elicitation.form`; otherwise it is declined | (defaulted: the question cannot be shown) | 03 |
| A select question with free text allowed is sent as its options only | (defaulted: the elicitation schema has no "options or text") | 03 |
| `completed` and `stopped` by a hook end as `end_turn`; `cancelled` as `cancelled`; `stopped: max_steps` as `max_turn_requests`; `failed` and the other stops as a JSON-RPC error with the turn's message | (defaulted: the closest stop reason ACP has) | 03 |
| `usage_update` reports the context fill when the backend knows it; the claude backend does not | (defaulted: `/context` is the cofold backend's) | 03 |
| `session/list` without `cwd` lists the sessions of `--workspace`, all in one page | (defaulted: copapo lists one workspace at a time) | 02 |
| `session/close` drops the session's subscription and cancels a running turn; `session/delete` calls `Chat.remove` | (defaulted: the ACP meanings) | 02 |
| `session/load` replays the transcript as updates before it answers; `session/resume` does not | the ACP meanings of load and resume | 04 |
| `Chat.create()` makes an empty session that `say` takes by its id, because `session/new` answers with an id before any turn | (defaulted: `say` refuses an id the store does not hold) | 01 |
| A mode or option set over ACP is the session's only; it is not written back into the configuration file | (defaulted: the screen's chips remember a pick, a protocol client sets a session) | 04 |
| A draft that is the start of the turn's last stored text is not sent, because the store holds the message a moment before the draft is dropped | (defaulted: found by the contract test, a fork sent its reply twice) | 03 |
| The contract test checks every frame copapo writes with the SDK's zod schemas, read from the SDK's files | (defaulted: the SDK exports no schema and checks only what it receives) | 05 |

## Proposed architecture

- **Data flow** - `acp/rpc.ts` reads one JSON-RPC message per line and writes one per line. It answers requests, takes notifications, and sends requests of its own with ids it counts. `acp/server.ts` maps each ACP method onto a `Chat`. `acp/project.ts` turns a `Snapshot` and what was sent before into the next `session/update` list.
- **Event flow** - A session's server state subscribes to `Chat`. On each change it reads the snapshot and sends the new updates. A new `pending` block becomes a request to the client, and its answer becomes `approve`, `deny` or `answer`.
- **State flow** - Each session keeps its `cwd`, the pending id it asked, and the prompts that wait on the turn. It also keeps what was sent for each text place, reasoning place and tool call. Nothing new is stored on disk.
- **Layer responsibilities** - copapo `acp/`: the protocol. copapo `chat.ts`, `claude/chat.ts`: `fork` and `context`. agents, store-file: unchanged.
- **Source-of-truth files** - [`code://packages/copapo/src/types/chat.ts`](../../../../packages/copapo/src/types/chat.ts), the new `packages/copapo/src/types/acp.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Chat forks a session and reads its context](task-01-chat-forks-and-reads-context.md) | implemented | - |
| [02 - copapo acp opens and lists sessions](task-02-acp-opens-and-lists-sessions.md) | implemented | - |
| [03 - A prompt runs a turn over ACP](task-03-a-prompt-runs-a-turn.md) | implemented | 01, 02 |
| [04 - Load, resume, fork, modes and commands](task-04-load-resume-fork-modes.md) | implemented | 01, 03 |
| [05 - The official client drives copapo acp](task-05-the-official-client-drives-acp.md) | implemented | 04 |

## Risks and tradeoffs

- `session/fork`, `resume`, `close` and `PromptResponse.usage` are marked unstable in the schema - they are advertised as capabilities, so a client that lacks them never calls them.
- A client that sends `mcpServers` gets a session without them - the README says so, and `deferred.md` keeps it.
- Diffing snapshots costs a store read per change - the screen does the same, and a turn's changes are few.

## Resume state

- **Done so far:** the plan, 2026-11-10. Tasks 01 to 05 implemented on 2026-11-10, not committed. `pnpm check`: 85 test files, 1107 tests.
- **Next action:** Softov reviews tasks 01 to 05 and sets them to done. Softov runs `copapo acp` from ahpd by hand as a custom ACP agent, for one turn. The `copapo` row in ahpd's `knownAgents` and `presets` is an ahpd plan, after a cofold release.
- **Watch out for:** stdout carries protocol only; every warning goes to stderr. A `Chat` warns on stderr by default.

## Final verification checklist

- [x] The contract test of task 05 runs a turn, a permission, a question, a cancel, a steer, a fork and a load through `ClientSideConnection`.
- [x] `pnpm typecheck` and `pnpm test` are green.
- [ ] ahpd runs `copapo acp` by hand as a custom ACP agent and finishes one turn.
