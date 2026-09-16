---
title: The review's fixes - counting, API errors, the CLI's ask options, durable settings
status: todo
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

