---
title: Slash commands - implemented
date: 2026-10-11
refs:
  - git://6f4e881 - agents goes to 0.3.0, released as @cofold/agents 0.3.0
  - git://b4fd1b3 - the plan's last commit before the release
  - "[code://packages/agents/src/run/slash.ts](../../../../packages/agents/src/run/slash.ts) - the runtime commands and the slash line parser"
  - "[code://packages/agents/src/run/turn.ts](../../../../packages/agents/src/run/turn.ts) - the run that emits the command events"
---

A line that starts with `/` is a command.
The harness runs a runtime command such as `/compact` as a run of its own, and it expands a skill into a prompt command.
papo keeps its client commands, and lists the runtime's commands in its `/` menu, in `/help` and in `papo commands`.

## What was built

- [`code://packages/agents/src/run/slash.ts`](../../../../packages/agents/src/run/slash.ts) - `SlashCommand`, the built-in `/compact` and the parser for a slash line.
- [`code://packages/agents/src/capabilities/skills.ts`](../../../../packages/agents/src/capabilities/skills.ts) - the skills as prompt commands.
- [`code://packages/papo/src/chat.ts`](../../../../packages/papo/src/chat.ts) - `commands()`, papo's own runtime commands and the queue for a slash line during a turn.
- [`code://packages/papo/src/claude/chat.ts`](../../../../packages/papo/src/claude/chat.ts) - the Claude backend lists the CLI's commands.

## Verified

- `packages/agents/src/run/slash.test.ts` (9 tests) and `packages/agents/src/capabilities/skills.test.ts` (10 tests), including "/review x writes an input and a skill message, and the first request carries both".
- `packages/papo/src/chat-contract.test.ts` runs `/compact` on both backends.
- `packages/papo/src/chat.test.ts` has "a slash line said while a turn runs waits in the queue and runs after the turn".
- `packages/agents/src/run/run.test.ts` has "compact() takes a messageId for its /compact input too".
- `packages/papo/src/screen/screen.test.ts` shows each name once in the `/` menu, on the cofold backend, at each test size.
- On 2026-10-15, `pnpm check` passes at the repository root: 77 files and 1027 tests.
- ahpd's agent-cofold suite passes against `@cofold/agents` 0.4.0 at ahpd git://deaf702e.

## Departures from the plan

- None.

## Left for later

- See [deferred.md](deferred.md).
