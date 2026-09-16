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
---

`papo --backend claude` (or `backend: claude`, `PAPO_BACKEND=claude`) runs the same screen and shell over Claude Code's runtime through its SDK: its tools, its permission rules, its sessions, its compaction.

## What was built

- One streaming-input `Query` per live session; `wait` resolves `awaiting` on a decision; failed turns kept per session by the prompt's uuid; what the stream delivered kept until the store has it; `config.backend`, `--backend`, `PAPO_BACKEND`; the workspace must be a directory.

## Verified

- 34 tests across `claude/*.test.ts` and the contract; `pnpm check` 611 green.
- The real CLI: models, a text turn, a `Write` that asks and is approved with `always`, an `AskUserQuestion` answered through the form's shape, `/compact` and a turn after it, `interrupt` mid-reply, `auto` running a `Write` without a decision.

## Departures from the plan

- Decision 6: `auto` is not `bypassPermissions` (the SDK answers `AskUserQuestion` too under it); the CLI runs in `default` and the callback allows every tool but the question.
- Decision 3: a `WarmQuery` takes one prompt; one streaming-input `Query` per session instead.
- `papo say` that stops at a decision denies it on exit and says so; the decision lives in the process.

## Left for later

- See [deferred.md](deferred.md); the five findings against the harness are in `plan.md`.
