---
title: CLI-03 - papo on the Claude Agent SDK: the same screen, Claude Code's runtime
domain: cli
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/cli/01-papo/plan.md
  - plans/cli/02-papo-commands/plan.md
---

# CLI-03 - papo on the Claude Agent SDK: the same screen, Claude Code's runtime

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
| 3 | `packages/papo/src/claude/{chat,project,permissions}.ts`: `createClaudeChat({ config, workspace, warn, sdk? })` implements `Chat` over one `Query` per session in use, fed a streaming input so one process serves the session's turns (a `WarmQuery` takes exactly one prompt; found on the real SDK); a throwaway `query` with an empty stream for `models()` / `skills()` without a session); `say` on an idle session is `warm.query(text)` with `resume: sessionId` (or a fresh `sessionId` for a new one); the `Query` is iterated in the background and every message wakes the listeners | The same shape as the harness `Chat`: attached handles, everything else read back |
| 4 | Sessions are the CLI's own: `sessions()` is `listSessions({ dir: workspace })` with activity from this process's attached queries; `snapshot(id)` projects `getSessionMessages(id, { dir: workspace })` with `project.ts`: each top-level user text message starts a `Turn`; assistant blocks become `text` / `reasoning` / `tool` parts; a `tool_result` completes the call; `compact_boundary` becomes a `summary` part; `parent_tool_use_id !== null` (subagent traffic) is folded into its parent call's output, not shown | One projection, tested against fixtures copied from real sessions |
| 5 | `canUseTool` becomes papo's pending block: a tool call → `toolConfirmation` with the harness's own `ChatToolCall` shape, `confirmationTitle` from `options.title`, the `always` option present when `suggestions` is non-empty (returned as `updatedPermissions`); `AskUserQuestion` → `chatInput` through `toChatQuestion` (header, question, options, multiSelect map one to one), answered as `updatedInput.answers` keyed by question text; a `deny` is `{ behavior: 'deny', message }` | The screen and the shell stay as they are |
| 6 | Settings map: `model` → `options.model` (refs are `claude/<model>`; `models()` lists `supportedModels()` under provider `claude`; a configured model of another provider is ignored with a warning); `reasoning` off/low/medium/high → `effort` absent/low/medium/high (a change restarts the session's process with `resume`, the SDK has no live `setEffort`); `permissions`: the CLI always runs in `default` mode and `canUseTool` applies papo's word: `auto` allows every tool but `AskUserQuestion` before the person sees it, `destructive` and `ask` hand the CLI's questions to the person (`ask` cannot make every tool ask; a warning once on stderr); `autoCompact` is refused as a setting (`the claude backend compacts on its own`) | What the SDK offers; `bypassPermissions` was the first cut for `auto` and is wrong: the SDK warns that it answers every tool before the callback, `AskUserQuestion` included, so a question under `auto` would be lost (found on the real CLI 2026-09-16) |
| 7 | `compact(id)` sends `/compact` as the prompt of a turn; the transcript afterwards is what `getSessionMessages` returns: the summary (`isCompactSummary`, shown as a `(context compacted)` turn), the retained tail, the `/compact` echo with its `Compacted` notice. `cancel` is `interrupt()` on a running turn (the result comes with `terminal_reason: 'aborted_streaming'`, projected as `cancelled`; the CLI writes `[Request interrupted by user]` into the transcript, shown as a notice) or a denial of the pending decision; `remove` is `deleteSession` | The CLI's own compaction and its own record of it; the `compact_boundary` stream message is not needed, the store says it |
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

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the SDK boundary and the projection](task-01-sdk-boundary-projection.md) | done | - |
| [02 - the service](task-02-service.md) | done | 01 |
| [03 - wiring and the contract](task-03-wiring-contract.md) | done | 02 |

## Findings: where the harness differs from Claude's runtime

Per decision 10 these are things to check against the harness, not decisions; Claude's runtime is the reference.

| # | Claude's runtime | The harness (papo over `@facio/agents`) | To check |
| --- | --- | --- | --- |
| F1 | After `/compact` the transcript is the summary, the retained tail and the command's echo; what came before is gone from the view | The store keeps every turn and appends a summary turn (`Summarize the conversation so far.`) at the end; the screen still shows the whole history | Whether papo's transcript after `/compact` should show what the model no longer sees; the harness's `contextOf` already feeds only the summary |
| F2 | The prompt's uuid is the client's (`SDKUserMessage.uuid`), echoed on every reply frame as `user_message_uuid` and kept as the transcript record's id | The harness mints the input message id on `run()`; `Started.runId` is the run, not the message | Whether `say` should take the message id from the caller, so a client can match a reply to its send without waiting |
| F3 | A tool the runtime refuses before asking (deny rules) is a `permission_denials` entry on the result, not a decision | The harness has no rule layer: `policy` decides ask/allow only | Whether `policy` should carry deny rules (`@facio/tools` may want them for `shell_exec`) |
| F4 | An interrupted turn leaves a marker in the transcript (`[Request interrupted by user]`) and the tool results it cut are marked as such | The harness's cancelled run leaves the run record `cancelled` and no message | Whether the harness should write a `notice`-like message on cancel, so a transcript read later says what happened |
| F5 | The CLI writes its transcript after it answers: a read right after the result can miss the turn | The harness writes the store before it answers | Nothing to change in the harness; the Claude backend keeps what the stream delivered until the store has it |

## Risks and tradeoffs

- The SDK moves fast (0.3.x, weekly): the plan pins `^0.3` and reads only the surface named above; a breaking change lands in `sdk.ts` and `project.ts`, nowhere else.
- A pending approval is in memory: papo dying mid-approval ends the CLI's turn; the session resumes with the next `say`. The harness keeps it on disk; that difference is a finding, not a bug to hide.
- The licence is Anthropic's, not MIT: an optional peer keeps papo's own licence clean, and the README says what installing it accepts.
- `ask` mode cannot be honoured; saying so on screen is better than pretending.

## Resume state

- **Done so far:** recon and plan 2026-09-16; Task 1 (SDK boundary, projection, fixtures), Task 2 (`createClaudeChat`, `permissions.ts`, the fake SDK, 12 tests) and Task 3 (`config.backend`, `--backend` / `PAPO_BACKEND`, `openPapo`, the optional peer in `package.json`, `chat-contract.test.ts` with 8 scenarios on both backends, README) built 2026-09-16. Verified on the real CLI (0.3.273, the user's login): `models`, a text turn, a `Write` that asks and is approved with `always`, an `AskUserQuestion` answered through the form's shape, `/compact` and a turn after it, `interrupt` mid-reply, `auto` running a `Write` without a decision. `papo say` that stops at a decision denies it on exit and says so (the decision lives in the process). A workspace that is not a directory is refused up front (the CLI reports a binary that "failed to launch" otherwise).
- **Next action:** none in this plan. The findings above go to the harness's plans (F1, F2, F4 to agent/01 p5; F3 to a policy plan).
- **Open questions:** none.
- **Watch out for:** `getSessionMessages` needs the same `dir` the session was created under; `listSessions` without `dir` searches every project; the SDK moves weekly, `pnpm check` after a bump.

## Final verification checklist

- [x] `pnpm check` green with the SDK present (610 tests); the absent path is `loadClaudeSdk`'s test (an importer that fails as Node does) - the SDK is a devDependency of the workspace, so it is never absent there.
- [x] The contract scenarios pass on both backends (`chat-contract.test.ts`, 16 tests).
- [x] Manual run against the real CLI, as Task 3 says (the screen itself was driven through `createClaudeChat`, the same calls it makes).
- [x] `index.md` updated.
