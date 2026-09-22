---
title: The review's fixes - counting, API errors, the CLI's ask options, durable settings
status: done
depends: [task-03-wiring-contract.md]
layer: papo
refs:
  - code://packages/papo/src/claude/project.ts#L130-L137 - steps and usage counted per stored entry, not per reply
  - code://packages/papo/src/claude/chat.ts - outcomeOf, the canUseTool callback, settings map, ended, handle, snapshot, sessions sort
  - code://packages/papo/src/claude/permissions.ts#L32-L40 - the confirmation block
  - code://packages/papo/src/commands.ts#L140-L144 - papo say denying one decision
  - code://packages/papo/src/chat.ts#L88-L96 - how the harness backend keeps settings in the store's kv, the primitive to reuse
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - CanUseTool options title, suppressAlwaysAllowRule, defaultToNo; SDKResultMessage is_error on success; PermissionUpdateDestination
---

## Objective

A reply split across several stored entries counts once; an API error is a failed turn; the confirmation shows the CLI's own sentence and offers `always` only when the CLI allows it, and `always` writes a session rule only; a session's settings survive a papo restart; `papo say` denies every decision it cannot hold; no stale error entry after `remove`; no duplicated prompt while the store catches up; `snapshot` reads one file, not the folder.

## Files

- `UPDATE: packages/papo/src/types/claude.ts` - `ClaudeMessage.id?: string` (the API message id, shared by the entries of one reply); `ClaudeDecision.title?: string`, `ClaudeDecision.suppressAlways: boolean`.
- `UPDATE: packages/papo/src/claude/project.ts:130-137` - count a reply once by `message.message.id` (a `counted` set beside `calls`); entries without an id count as today.
- `UPDATE: packages/papo/src/claude/chat.ts` - `outcomeOf`: `subtype 'success'` with `is_error` is `failed { code: 'api_error', message: result.result }`; the callback fills `title` and `suppressAlways` from `opts.title` and `opts.suppressAlwaysAllowRule`; `ended` returns when `live.get(sessionId) !== entry`; `handle` skips a message whose uuid `seen` already holds; `snapshot` drops `listSessions` (title from the first input, dates from the first and last message timestamps); the `sessions` sort uses `localeCompare`; settings read and written through the file store's kv under the same `settingsKey` the harness backend uses (`createFileStore({ root: home }).kv`), removed in `remove`.
- `UPDATE: packages/papo/src/claude/permissions.ts:32-40` - `confirmationTitle: decision.title ?? \`Run ${decision.toolName}?\``; `always` offered when `suggestions` is non-empty and `!suppressAlways`; `approval()` rewrites every suggestion to `destination: 'session'`.
- `UPDATE: packages/papo/src/types/chat.ts`, `commands.ts` - `createClaudeChat({ config, workspace, home, ... })`; `openPapo` passes `home`.
- `UPDATE: packages/papo/src/commands.ts:140-144` - `while (outcome?.status === 'awaiting' && backend === 'claude')` deny and wait again.
- `UPDATE: packages/papo/src/claude/testing.ts` - `say()` stores one entry per block sharing a `message.id`; `FakeReply.tool` takes optional `title` and `suppressAlways` and passes them to `canUseTool`; a `FakeReply` for an API error (`{ apiError: string }` → `subtype 'success', is_error: true, result`).
- `UPDATE: packages/papo/src/claude/fixtures/` - a fixture with one `message.id` split across `thinking`, `text`, `tool_use` entries.
- `UPDATE: packages/papo/README.md` - the claude section: `always` is a session rule; settings kept under `home`.

## Steps

1. Types first, then `project.ts` (decision 4 amended), then `chat.ts` and `permissions.ts` (decisions 5 and 6 amended), then the shell, then the fake and the tests.
2. Settings durability reuses the store's kv rather than a new JSON file: `settingsKey` and the record shape are the harness backend's, so `session set` and the chips read the same thing on both backends.
3. `approval()`: `updatedPermissions: suggestions.map((rule) => ({ ...rule, destination: 'session' }))` when `always`.

## Validation

- `project.test.ts`: the split fixture gives `steps: 1` and the usage once.
- `claude/chat.test.ts`: an API error is `failed` with an error part; a decision with `title` shows it as `confirmationTitle`; `suppressAlways` hides the option; `always` sends `destination: 'session'` on a `userSettings` suggestion; settings survive a second `createClaudeChat` over the same `home`; `remove` during a turn leaves no error entry; a replayed prompt is not shown twice.
- `chat-contract.test.ts`: `confirmationTitle` asserted on both backends.
- `commands.test.ts`: `say` on claude denies two decisions in a row and prints the reply.
- `pnpm check`; the manual list of `implemented.md` with reasoning on, then `/cost` after a `thinking + text + tool_use` reply.

## Resume

- **Done (2026-09-16):** every file in *Files* changed as written.
  `ClaudeMessage.id`, `ClaudeDecision.title` and `suppressAlways`; `projectSession` counts a reply once by `message.id` (`counted` beside `calls`); `outcomeOf` maps `success` with `is_error` to `failed { code: 'api_error' }`; the callback carries `title` and `suppressAlwaysAllowRule`; `pendingOf` shows the CLI's sentence and withholds `always`; `approval()` rewrites every suggestion to `destination: 'session'`; `ended` records nothing for a session this service let go of; `handle` drops a uuid `seen` already holds; `snapshot` reads one file (title from the first input that is not the compaction marker, dates from the first and last timestamps); `sessions` sorts with `localeCompare`; settings live in `createFileStore({ root: home }).kv({ kind: 'workspace', workspace })` under `settingsKey`, now exported from `src/chat.ts` so both backends share the one key, and are deleted in `remove`.
  `ClaudeChatOptions` moved to `src/types/chat.ts` (the rule: exported interfaces live in `types/`) and gained `home`; `openPapo` passes it.
  `papo say` loops `while (awaiting && backend === 'claude')`.
  The fake stores and streams one entry per block sharing a `message.id`, echoes the prompt on the stream under the client's uuid, writes its store at the result (as the CLI does, F5), takes `title` and `suppressAlways`, answers `{ apiError }` as `success` with `is_error`, records every `PermissionResult` in `decisions`, and `then` may be a second ask (`FakeToolReply`), which is how a turn that stops twice is scripted.
  Fixture `claude/fixtures/split-reply.json`: one reply over `thinking`, `text`, `tool_use` entries sharing `msg_01SplitReplyAcrossEntries`, its tool result, and a second one-entry reply.
- **Evidence:** `pnpm vitest run --project @cofold/papo`: 8 files, 88 tests green (was 81); `project.test.ts` 7, `claude/chat.test.ts` 18, `chat-contract.test.ts` 16, `commands.test.ts` 7.
  The split reply alone gives `steps: 1` and `usage { 29263, 212 }`; with the second reply `steps: 2`, `usage { 58620, 230 }`.
  `pnpm --filter @cofold/papo typecheck` clean.
- **Deviations:** `ended` does not merely return when the entry was let go of: it settles the turn `cancelled` (reason `the session was removed`) so a `wait()` on it resolves instead of hanging; it records no error, which is what the step asked for.
  `sessions()` adds the sessions live here that `listSessions` does not return yet: once the fake wrote its store at the result, as the CLI does, a session started here was absent from the catalogue until its first result ended (a real gap the old fake hid); the row is read off `seen`.
  The split fixture holds a second, one-entry reply after the tool result, as a real session does; the test asserts `steps: 1` on the first five entries and `steps: 2` on the whole.
- **Found, not acted on:** the SDK's `defaultToNo` (the ask must not be approvable by one keystroke) is not read; papo's block has no such affordance to withhold.
  `shortTitle` was split out of `titleOf` in `src/turns.ts` so both backends shorten a title the same way.
- **Manual run against the real CLI** (the last line of *Validation*): not done in this session; the fake's stream and store shapes are the ones recorded from real sessions (fixtures) and the SDK's types.

