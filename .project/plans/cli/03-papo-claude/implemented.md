---
title: papo on the Claude Agent SDK - implemented
date: 2026-09-16
refs:
  - git://91ba15b - Task 1, SDK boundary and projection
  - git://f37dd8c - Task 2, the service
  - git://80dd80f - Task 3, wiring and the contract
  - git://819a7e6 - the first say from the screen
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - the optional peer
  - code://packages/papo/src/claude/sdk.ts - the peer loaded lazily, named when absent
  - code://packages/papo/src/claude/project.ts - the CLI transcript as Turn[]
  - code://packages/papo/src/claude/permissions.ts - canUseTool as the block
  - code://packages/papo/src/claude/chat.ts - createClaudeChat
  - code://packages/papo/src/claude/testing.ts - the fake SDK
  - code://packages/papo/src/chat-contract.test.ts - eight scenarios on both backends
  - code://packages/papo/src/claude/fixtures/split-reply.json - one reply the CLI stored as three entries, sharing `message.id`
  - code://packages/papo/src/chat.ts - `settingsKey`, the one kv key both backends keep a session's settings under
---

`papo --backend claude` (or `backend: claude`, `PAPO_BACKEND=claude`) runs the same screen and shell over Claude Code's runtime through its SDK: its tools, its permission rules, its sessions, its compaction.

## What was built

- One streaming-input `Query` per live session; `wait` resolves `awaiting` on a decision; failed turns kept per session by the prompt's uuid; what the stream delivered kept until the store has it; `config.backend`, `--backend`, `PAPO_BACKEND`; the workspace must be a directory.
- After the review (task 4): a reply the CLI stored as several entries counts once for `steps` and `usage`; a `success` result with `is_error` is a failed turn (`api_error`); the confirmation shows the CLI's `title` and offers `always` only when the CLI sent suggestions and did not set `suppressAlwaysAllowRule`; a session's settings live in the file store's kv under `home` at the harness backend's key, deleted with the session; `papo say` denies every decision the turn stops at; `remove` mid-turn records no failed turn; the prompt the stream echoes is shown once; `snapshot` reads one session file; `sessions()` adds a session started here before the CLI has written it.

## Verified

- 34 tests across `claude/*.test.ts` and the contract; `pnpm check` 611 green (tasks 1-3).
- After task 4: 88 papo tests (`claude/project.test.ts` 7, `claude/chat.test.ts` 18, `chat-contract.test.ts` 16, `commands.test.ts` 7); the split fixture gives `steps: 1` for the split reply and its usage once.
- Owed: the manual run with reasoning on and `/cost` after a `thinking + text + tool_use` reply on the real CLI.
- The real CLI: models, a text turn, a `Write` that asks and is approved with `always`, an `AskUserQuestion` answered through the form's shape, `/compact` and a turn after it, `interrupt` mid-reply, `auto` running a `Write` without a decision.

## Departures from the plan

- Decision 6: `auto` is not `bypassPermissions` (the SDK answers `AskUserQuestion` too under it); the CLI runs in `default` and the callback allows every tool but the question.
- Decision 3: a `WarmQuery` takes one prompt; one streaming-input `Query` per session instead.
- `papo say` that stops at a decision denies it on exit and says so, every decision the turn stops at in turn; the decision lives in the process.
- Decision 5 (R3): the confirmation's title is the CLI's own sentence (`CanUseTool`'s `options.title`) when it sends one, `Run <name>?` otherwise; `always` is withheld when the CLI sets `suppressAlwaysAllowRule`.
- Decision 5 (R4): `always` returns the CLI's suggestions with every `destination` rewritten to `session`; the button's word holds, and nothing is written into a settings file.
- Decision 6 (R5): settings are not in memory but in the file store's kv under `home`, at the same key the harness backend uses; `createClaudeChat` takes `home`.
- Decision 4 (R1, R9): a reply is counted once by `message.id`; `snapshot` no longer calls `listSessions` for the row.

## Left for later

- See [deferred.md](deferred.md); the five findings against the harness are in `plan.md`.
