---
title: CLI domain - current state
domain: cli
revalidated: 2026-09-16
---

# CLI domain - current state

The `cli` domain covers the programs a person runs against `@doopx/agents`: the chat TUI first, the command CLI (with the `facio` command framework) later.

## What exists today (2026-09-16)

- `packages/papo` (`@doopx/papo`, binary `papo`) is the one program: a screen and a shell over `@doopx/agents` in this process, commands declared on `@doopx/commands`, run through `@doopx/terminal`, drawn with `@textui/chat`.
- The chat components live outside this repo: `@textui/chat` (textui, published), prop-driven components only, extracted from `ahpc`; the application layer is papo's.

## Plans

| Plan | Objective |
| --- | --- |
| [01-papo](01-papo/plan.md) | papo: the service, the shell, the screen (built) |
| [02-papo-commands](02-papo-commands/plan.md) | papo slash commands (built; the internal ones move to agent/03) |
| [03-papo-claude](03-papo-claude/plan.md) | papo on the Claude Agent SDK, the harness's contra-validation (built; findings F1-F8) |
| [04-papo-harness-adoption](04-papo-harness-adoption/plan.md) | steer and queue, partial text, the model's view, stop reasons, Claude's permission modes and rules (built) |
| [05-papo-defaults-picker-thought](05-papo-defaults-picker-thought/plan.md) | picks written back to the configuration, provider-then-model chip, cursor bar, thought on click (active) |

Next free number: `06`.

Later: the `facio` program (`packages/facio`: the daemon and its CLI on `@doopx/terminal`, slash commands as commands, settings), once the chat has validated the harness end to end.
