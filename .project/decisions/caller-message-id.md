---
title: 114 - The caller may supply the input message id
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/run.ts#L74-L76 - the input message minted with `newId()`, `inputMessageId` on the run record
  - code://packages/agents/src/types/run.ts#L7-L21 - `RunArgs` / `CompactArgs`
  - code://ahpd/packages/agent-claude/src/session.ts#L1763-L1778 - the prompt's `uuid` recorded on the first `user` echo, the fork point
  - code://.project/plans/cli/03-papo-claude/plan.md#L101 - finding F2
---

## Context

Claude's prompt id is the client's (`SDKUserMessage.uuid`), echoed on every reply frame, so a client matches a reply to its send without waiting. Ours was minted inside `run()`.

## Decision

`RunArgs.messageId?` and `CompactArgs.messageId?` (default `newId()`). A duplicate in the session finishes the handle `failed { code: 'already_exists' }` with no store writes. `run.started.input.id` and `RunRecord.inputMessageId` carry it.

Source: user, 2026-09-16, asked "`messageId` / `inputId` / `uuid`".

## Consequences

`setupRun` scans the session's messages when an id is given (one transcript read, which a run does anyway for its first step).
