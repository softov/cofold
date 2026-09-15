# CLI domain - current state

The `cli` domain covers the programs a person runs against `@facio/agents`: the chat TUI first, the command CLI (with the `facio` command framework) later.

## What exists today (2026-09-16)

- Nothing under `packages/` is a program. `examples/*.ts` are scripts that prove one thing each.
- The chat components live outside this repo: `@textui/chat` (textui, published), prop-driven components only, extracted from `ahpc`; the application layer is not textui's.

## Plans

None open.
Next: papo, the chat program over `@facio/agents` in this process, with its commands declared on `@facio/commands` and run through `@facio/terminal`.

Later: the `facio` program (`packages/facio`: the daemon and its CLI on `@facio/terminal`, slash commands as commands, settings), once the chat has validated the harness end to end.
