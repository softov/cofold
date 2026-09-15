# CLI domain - current state

The `cli` domain covers the programs a person runs against `@facio/agents`: the chat TUI first, the command CLI (with the `facio` command framework) later.

## What exists today (2026-09-16)

- Nothing under `packages/` is a program. `examples/*.ts` are scripts that prove one thing each.
- The chat UI lives outside this repo: `@textui/chat` (textui repo, plan `roadmap/plans/chat/01-textui-chat.md` there), extracted from `ahpc`.

## Plans

| Plan | Objective |
| --- | --- |
| [01-facio-chat.md](01-facio-chat.md) | `@facio/chat`: the harness as a `HostConnection`, and the `facio-chat` binary |

Later: the `facio` CLI (commands, slash commands as commands, settings), once the chat has validated the harness end to end.
