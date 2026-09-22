---
title: CLI-06.1 - /chat.usage replaces /chat.cost; a session's usage is summed by the harness, with no prices
status: accepted
date: 2026-09-18
refs:
  - code://packages/agents/src/store/usage.ts - `sessionUsage`
  - code://packages/papo/src/screen/app.tsx - `chat.usage`
  - code://.project/plans/cli/04-papo-harness-adoption/deferred.md - `Turn.cost` and `/cost` in dollars stay deferred
---

## Context

papo's `Cost` panel printed tokens per turn and never a price; the user asked for a usage readout from what the harness records, without costs or an external dependency.
The fork: replace the panel, or keep `Cost` beside a new `Usage` for the day dollars arrive.

## Decision

`/chat.usage` replaces `/chat.cost`: one panel named for what it shows, from `sessionUsage` in `@doopx/agents` (per run: tokens by kind, steps, tool calls, denials; and the sums).
`Chat.usage(sessionId)` exists on both backends; the shell has `papo usage <session>`.
Dollars stay in cli/04's `deferred.md`.

Source: user (2026-09-18), asked "`/usage`: what happens to the existing `/chat.cost` panel (tokens per turn, no dollars)?" with "Replace it with /chat.usage" and "Add /chat.usage, keep /chat.cost": "Replace it with /chat.usage (Recommended)".

## Options

Keeping both would have shown the same numbers under two names until a cost existed.
