<!--
Domain: cli
Status: Planned
Priority: High
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: ./01-papo.md (Built), ./02-papo-commands.md (Built)
Reference: ./00-cli.md
-->

# CLI-03 - papo on the Claude Agent SDK: the same screen, Claude Code's runtime

_Status: Planned · Priority: High · Created: 2026-09-16_

## Goal

`papo --backend claude` (or `backend: "claude"` in the configuration) runs the same screen and shell over Claude Code's own runtime through `@anthropic-ai/claude-agent-sdk`: its tools, its permission system, its sessions, its compaction.
Nothing in papo's fronts changes; what changes is the `Chat` behind them.
The point is contra-validation: the harness's behaviour (approvals, questions, compaction, the transcript) is checked against a runtime a person already trusts, with the same keys and the same blocks on screen, and the projection from a Claude session to `Turn[]` says where the two disagree.
User (2026-09-16): "I wanted the claude sdk, not a api request. That way we can enforce some validations that using API we will not."

## Reconnaissance

Read from the published package, `@anthropic-ai/claude-agent-sdk@0.3.273` (`sdk.d.ts`, 9 313 lines; `sdk-tools.d.ts`), unpacked in the scratchpad; not installed anywhere in the tree.

- `query({ prompt, options }): Query` - `Query extends AsyncGenerator<SDKMessage>` with `interrupt()`, `setPermissionMode()`, `setModel()`, `supportedCommands()`, `supportedModels()`, `getContextUsage()`, `streamInput()`, `close()`. `prompt` is a string or an `AsyncIterable<SDKUserMessage>` (streaming input keeps one process for many turns).
- `startup({ options }): Promise<WarmQuery>` - a process started ahead of the first prompt; `warm.query(prompt)` binds it. What a screen wants for `supportedModels()` / `supportedCommands()` before anything is said.
- `Options` (the ones this plan uses): `cwd`, `model`, `effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, `permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`, `allowDangerouslySkipPermissions`, `canUseTool`, `resume: sessionId`, `sessionId`, `systemPrompt: { type: 'preset', preset: 'claude_code', append? }`, `settingSources`, `abortController`, `includePartialMessages`, `maxTurns`, `pathToClaudeCodeExecutable`.
- `CanUseTool = (toolName, input, { signal, suggestions?, title?, blockedPath?, decisionReason? }) => Promise<PermissionResult>`; `PermissionResult` is `{ behavior: 'allow', updatedInput?, updatedPermissions? }` or `{ behavior: 'deny', message, interrupt? }`. `suggestions` is what "always allow" returns as `updatedPermissions`.
- `AskUserQuestion` is a tool: it reaches the host through `canUseTool('AskUserQuestion', input)`; `AskUserQuestionInput.questions[]` is `{ question, header, options: { label, description }[2..4], multiSelect }` and the host answers with `{ behavior: 'allow', updatedInput: { ...input, answers: { [question]: 'label' } } }` (`answers` is "collected by the permission component"; multi-select answers are comma-separated). The same shape the harness's `ask_user` was modelled on.
- Messages: `SDKSystemMessage { subtype: 'init', cwd, tools, model, permissionMode, slash_commands, skills }`, `SDKAssistantMessage { message: BetaMessage (content blocks text / thinking / tool_use), parent_tool_use_id }`, `SDKUserMessage { message: MessageParam (tool_result blocks), tool_use_result? }`, `SDKResultMessage { subtype: 'success' | 'error_*', result, usage, modelUsage, total_cost_usd, permission_denials, num_turns }`, `SDKCompactBoundaryMessage { subtype: 'compact_boundary', compact_metadata: { trigger: 'manual' | 'auto', pre_tokens } }`, `SDKPartialAssistantMessage` (with `includePartialMessages`).
- Sessions are the CLI's own JSONL under `~/.claude/projects/<cwd>/`: `listSessions({ dir })` → `SDKSessionInfo { sessionId, summary, lastModified }`; `getSessionMessages(id, { dir })` → `SessionMessage { type, uuid, message: unknown, parent_tool_use_id }`; `deleteSession`, `renameSession`, `forkSession`.
- `SlashCommand { name, description, argumentHint }` from `supportedCommands()`: the skills and the CLI's commands in one list.
- The package is 5 MB of JS plus a native CLI per platform as optional dependencies (`@anthropic-ai/claude-agent-sdk-win32-x64` and seven others); Node >= 18; licence "SEE LICENSE IN README.md" (not MIT). It authenticates as the CLI does (the person's Claude login, or `ANTHROPIC_API_KEY`).

### Gaps against `Chat`

| `Chat` | The SDK has | Gap |
| --- | --- | --- |
| `sessions()` | `listSessions({ dir })` | activity (`idle` / `running` / `awaiting`) is this process's knowledge only |
| `snapshot(id)` | `getSessionMessages` | a projection to `Turn[]` is to be written; run boundaries are the user prompts, not run ids |
| `say` | `query` / `streamInput` | one `Query` per session, kept while it runs |
| `approve` / `deny` / `answer` | the pending `canUseTool` promise | in memory: a process that dies mid-approval loses it (the CLI ends the turn); `resume` continues the session afterwards |
| `cancel` | `interrupt()` | - |
| `compact` | the prompt `/compact` | `compact_boundary` says it happened |
| `models()` | `supportedModels()` on a warm query | - |
| `skills()` | `supportedCommands()` | skills and commands come as one list; papo shows them as `session` slash commands |
| `settings` | `model`, `effort`, `permissionMode` | `ask` has no equivalent (the CLI decides what asks); `autoCompact` is the CLI's own |
| `remove` | `deleteSession` | - |

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | The backend is chosen per process: `config.backend: 'facio' \| 'claude'` (default `facio`), overridden by `--backend` / `PAPO_BACKEND`. `openPapo` builds `createChat` or `createClaudeChat`; the fronts do not know which | Two runtimes share nothing below `Chat`; switching per session would be two catalogues in one list |
| 2 | `@anthropic-ai/claude-agent-sdk` is an optional peer of `@facio/papo`, imported lazily by `createClaudeChat`; absent, `papo --backend claude` fails with `install @anthropic-ai/claude-agent-sdk to use the claude backend` | Zero third-party dependencies (the one optional peer pattern of `@facio/mcp`); 5 MB plus a native binary is not something every papo carries |
| 3 | `packages/papo/src/claude/{chat,project,permissions}.ts`: `createClaudeChat({ config, workspace, warn })` implements `Chat` over one `WarmQuery` per session in use (`startup` once for `models()` / `skills()` without a session); `say` on an idle session is `warm.query(text)` with `resume: sessionId` (or a fresh `sessionId` for a new one); the `Query` is iterated in the background and every message wakes the listeners | The same shape as the harness `Chat`: attached handles, everything else read back |
| 4 | Sessions are the CLI's own: `sessions()` is `listSessions({ dir: workspace })` with activity from this process's attached queries; `snapshot(id)` projects `getSessionMessages(id, { dir: workspace })` with `project.ts`: each top-level user text message starts a `Turn`; assistant blocks become `text` / `reasoning` / `tool` parts; a `tool_result` completes the call; `compact_boundary` becomes a `summary` part; `parent_tool_use_id !== null` (subagent traffic) is folded into its parent call's output, not shown | One projection, tested against fixtures copied from real sessions |
| 5 | `canUseTool` becomes papo's pending block: a tool call → `toolConfirmation` with the harness's own `ChatToolCall` shape, `confirmationTitle` from `options.title`, the `always` option present when `suggestions` is non-empty (returned as `updatedPermissions`); `AskUserQuestion` → `chatInput` through `toChatQuestion` (header, question, options, multiSelect map one to one), answered as `updatedInput.answers` keyed by question text; a `deny` is `{ behavior: 'deny', message }` | The screen and the shell stay as they are |
| 6 | Settings map: `model` → `options.model` (refs are `claude/<model>`; `models()` lists `supportedModels()` under provider `claude`); `reasoning` off/low/medium/high → `effort` absent/low/medium/high; `permissions` destructive → `default`, auto → `bypassPermissions` + `allowDangerouslySkipPermissions`, ask → `default` with a warning in the status row ("claude decides what asks; ask is default here"); `autoCompact` → not sent, the `/autocompact` badge reads `claude` and the toggle says so | What the SDK offers; nothing invented |
| 7 | `compact(id)` sends `/compact` as the prompt of a turn; the projection reads the `compact_boundary` that follows. `cancel` is `interrupt()`; `remove` is `deleteSession` | The CLI's own compaction and its own record of it |
| 8 | `/cost` and `/status` read the per-turn `SDKResultMessage.usage` kept in the projection (`Turn.usage`) and `total_cost_usd` where the CLI reports it; `Turn.steps` is `num_turns` | Same fields, the CLI's numbers |
| 9 | `systemPrompt: { type: 'preset', preset: 'claude_code', append: <config.instructions when set> }`, `settingSources: ['user', 'project']`, `cwd: workspace`: the person's Claude Code setup applies (CLAUDE.md, skills, MCP servers, hooks) | Contra-validation means Claude as the person already runs it |
| 10 | Contract tests: `packages/papo/src/chat-contract.test.ts` runs the same scenarios (say, approve, deny, ask, cancel, compact, remove) against both backends, the Claude one over a fake `query` (a scripted `AsyncGenerator<SDKMessage>` with a `canUseTool` hook), so the two agree on what a `Snapshot` says for the same story; a manual run against the real CLI is the final check. Where the two disagree, the harness is presumed wrong and the difference is a thing to check, not a decision to record: Claude's runtime is the reference | User (2026-09-16): "If ours is divergent, mostly it's ours that's wrong... divergence is not a decision, it is a thing to be checked" |
| 11 | Not done: streaming (`includePartialMessages`) until the harness has `model.delta` (p5 Task 5), so both backends land text whole; subagent transcripts; Claude's own slash commands beyond `/compact` (they arrive in `supportedCommands()` and are typed like skills, which works, but papo promises nothing about them); hooks; MCP configuration from papo | Scope |

## Proposed architecture

```
packages/papo/
  package.json                       UPDATE: peerDependencies (optional) @anthropic-ai/claude-agent-sdk ^0.3
  src/types/config.ts                UPDATE: backend
  src/config.ts                      UPDATE: schema, PAPO_BACKEND
  src/commands.ts                    UPDATE: --backend global; openPapo picks the chat
  src/claude/chat.ts                 CREATE: createClaudeChat(options): Chat
  src/claude/project.ts              CREATE: projectSession(messages, live) -> { turns, pending }
  src/claude/permissions.ts          CREATE: the pending canUseTool as ChatPendingInput; answers back
  src/claude/sdk.ts                  CREATE: the lazy import and its error
  src/claude/testing.ts              CREATE: fakeQuery(script): a scripted SDK for the tests
  src/claude/*.test.ts               CREATE
  src/chat-contract.test.ts          CREATE: the scenarios both backends must agree on
  README.md                          UPDATE: the backend, what maps and what does not
```

## Phases

### Task 1 - the SDK boundary and the projection

- `sdk.ts`, `project.ts` with fixtures (a text turn, a tool turn with result, an `AskUserQuestion` turn, a compact boundary, a subagent call), `Turn.usage` from results.
- **Validation:** fixtures project to the expected `Turn[]`; a missing SDK gives the install sentence.

### Task 2 - the service

- `createClaudeChat`: warm query, `say` / `wait` / `subscribe`, `sessions` / `snapshot` / `remove`, `models` / `skills`, settings mapping, `cancel`, `compact`.
- `permissions.ts`: `approve` / `deny` / `answer` over the pending promise; `always`.
- **Validation:** over `fakeQuery`: the seven scenarios of decision 10; a second `say` while running is `writer_busy`.

### Task 3 - wiring and the contract

- `config.backend`, `--backend`, `openPapo`; the contract test file; README.
- **Validation:** `pnpm check`; `papo --backend claude` against the installed CLI: a reply, an Edit that asks and is approved on screen, an `AskUserQuestion` answered in the form, `/compact`, `/cost`, `/models`.

## Risks and tradeoffs

- The SDK moves fast (0.3.x, weekly): the plan pins `^0.3` and reads only the surface named above; a breaking change lands in `sdk.ts` and `project.ts`, nowhere else.
- A pending approval is in memory: papo dying mid-approval ends the CLI's turn; the session resumes with the next `say`. The harness keeps it on disk; that difference is a finding, not a bug to hide.
- The licence is Anthropic's, not MIT: an optional peer keeps papo's own licence clean, and the README says what installing it accepts.
- `ask` mode cannot be honoured; saying so on screen is better than pretending.

## Resume state

- **Done so far:** recon and plan 2026-09-16; Task 1 built 2026-09-16 (`src/types/claude.ts`, `src/claude/{sdk,project}.ts`, fixtures from two real sessions in `src/claude/fixtures/`, 6 tests). The SDK is a devDependency of papo for the tests (`^0.3.273`); the peer declaration comes with Task 3. Findings from the real CLI: `getSessionMessages` after a compaction returns the summary (`isCompactSummary`), the retained tail, then the `/compact` echo (`<command-name>`) and its `<local-command-stdout>`; the originals are gone from that view. `canUseTool` in 0.3.273 passes no `title` / `decisionReason`; `suggestions` for a Write is `[{ type: 'setMode', mode: 'acceptEdits' }]`. A `WarmQuery` takes exactly one prompt.
- Task 2 built 2026-09-16: `src/claude/chat.ts` (`createClaudeChat`; one streaming-input `Query` per live session, `setModel` / `setPermissionMode` between turns, an effort change closes and resumes; `canUseTool` becomes a `ClaudeDecision` that `approve` / `deny` / `answer` resolve; `wait` resolves `awaiting` when a decision appears, as the harness does; failed turns kept per session keyed by the result's `user_message_uuid`), `src/claude/permissions.ts`, `src/claude/testing.ts` (`fakeClaudeSdk`: scripted replies, the store in the real message shapes, `canUseTool` asked as the CLI asks), 11 tests over the seven scenarios, `writer_busy`, resume, models and commands, settings.
- **Next action:** Task 3. `config.backend`, `--backend` / `PAPO_BACKEND`, `openPapo` picks the chat, the optional peer in `package.json`, `chat-contract.test.ts` over both backends, README.
- **Open questions:** none.
- **To check on the real CLI (things the fake assumes; ours is presumed wrong where they differ):** the transcript after an interrupt (the fake writes `[Request interrupted by user]` as a user message, projected as a notice) and the result it ends with (assumed `terminal_reason: 'aborted_streaming'`, projected as `cancelled`); `user_message_uuid` on the result; `AskUserQuestion`'s stored `tool_result` content; `SDKSessionInfo.createdAt` presence.
- **Watch out for:** `getSessionMessages` needs the same `dir` the session was created under; `listSessions` without `dir` searches every project.

## Final verification checklist

- [ ] `pnpm check` green with the SDK absent (the optional peer path) and present.
- [ ] The contract scenarios pass on both backends.
- [ ] Manual run against the real CLI, as Task 3 says.
- [ ] `index.md` updated.
