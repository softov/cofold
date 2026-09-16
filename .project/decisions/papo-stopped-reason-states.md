---
title: CLI-04.4 - A hook stop is a complete turn; a limit stop is a failed turn that says which limit
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/turns.ts#L86-L89 - `stateOf`: every `stopped` maps to `cancelled`
  - code://packages/papo/src/turns.ts#L64 - the error part reads `input.errors[runId]`
  - code://packages/papo/src/commands.ts#L394 - the shell prints `stopped` outcomes
  - code://.project/decisions/policy-decides-allow-ask-deny.md - decision 97 (p5): `stopped { reason: 'hook' }` is the run ending on purpose
---

## Context

p5 gave `stopped` a `reason` (`max_steps | max_tool_calls | timeout | policy | hook | max_cost`), and a `hook` stop is a turn that finished on purpose (`notify_done`), while a limit is a turn that could not finish. papo showed every `stopped` as cancelled.

## Decision

`stateOf`: `stopped { reason: 'hook' }` → `complete`; every other `stopped` → `failed`, with the error part reading `stopped: <reason>` (`max_steps`, `max_tool_calls`, `timeout`, `policy`, `max_cost`). `cancelled` stays `cancelled`. The shell prints the same words.

Source: user, 2026-09-16, asked "hook → complete; limits → failed with the reason / All stopped → cancelled with the reason shown".

## Consequences

A turn ended by `notify_done` looks finished, as it does under Claude; a budget or step limit looks like what it is.
