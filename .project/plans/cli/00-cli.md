---
title: CLI domain - current state
domain: cli
revalidated: 2026-09-16
---

# CLI domain - current state

The `cli` domain covers the programs a person runs against `@facio/agents`: the chat TUI first, the command CLI (with the `facio` command framework) later.

## What exists today (2026-09-16)

- `packages/papo` (`@facio/papo`, binary `papo`) is the one program: a screen and a shell over `@facio/agents` in this process, commands declared on `@facio/commands`, run through `@facio/terminal`, drawn with `@textui/chat`.
- The chat components live outside this repo: `@textui/chat` (textui, published), prop-driven components only, extracted from `ahpc`; the application layer is papo's.

## Plans

| Plan | Objective |
| --- | --- |
| [01-papo.md](01-papo/plan.md) | papo: the service, the shell, the screen (Built) |

Next free number: `02`.

Later: the `facio` program (`packages/facio`: the daemon and its CLI on `@facio/terminal`, slash commands as commands, settings), once the chat has validated the harness end to end.
