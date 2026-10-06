---
title: The terminal asks before a remove
status: done
depends: [task-01-the-declaration-says-what-it-does-to-what.md]
layer: "terminal"
refs:
  - "[code://packages/terminal/src/globals.ts#L12-L19](../../../../packages/terminal/src/globals.ts#L12-L19) - the standard globals, where `--yes` joins"
  - "[code://packages/terminal/src/program.ts#L144-L170](../../../../packages/terminal/src/program.ts#L144-L170) - from the parsed command to `registry.execute`"
  - "[code://packages/terminal/src/program.ts#L46-L49](../../../../packages/terminal/src/program.ts#L46-L49) - the one TTY check today, on stdin"
  - "[code://packages/terminal/src/types/program.ts](../../../../packages/terminal/src/types/program.ts) - `ProgramOptions`, which gains `confirm`"
  - "[code://packages/terminal/src/program.test.ts](../../../../packages/terminal/src/program.test.ts) - the program cases"
  - "[code://ROADMAP.md#L19](../../../../ROADMAP.md#L19) - a question must never trigger in a script"
---

## Objective

Before running a command whose effect is `remove`, the terminal asks on stderr when it has a terminal to ask on, runs it on `y` or `yes`, and otherwise prints `<program>: not run` and exits 1; `--yes` skips the question; off a terminal it is refused with exit 2 and a message saying to pass `--yes`.

## Files

- `UPDATE: packages/terminal/src/globals.ts:12-19` - `{ name: "--yes", description: "Run a command that removes something without asking" }`.
- `UPDATE: packages/terminal/src/types/program.ts` - `confirm?: ((question: string) => Promise<boolean>) | false`: absent means a `node:readline` question when stdin and stderr are both TTYs and no terminal otherwise; `false` means no terminal; a function is the terminal, for tests and embedders.
- `UPDATE: packages/terminal/src/program.ts` - after the input is built and before `execute`: when `command.effect === "remove"` and `--yes` is not set, ask `<words> removes <kind> <input[key]>. Continue? [y/N] ` (the kind and key value only when the resource has them); with no terminal, print `<program>: <words> removes <kind> <key value>; pass --yes to run it without a terminal` on stderr and exit 2 without running it.
- `UPDATE: packages/terminal/src/program.test.ts` - the cases below.

## Steps

1. Tests first, with `confirm` injected.
2. Add `--yes` and `confirm`, then the question.

## Validation

- `confirm` answering true runs the handler; answering false does not run it, prints `not run` on stderr, exits 1; both fail first because nothing asks.
- `--yes` runs it without calling `confirm`.
- A command with `effect: "change"` or no effect never calls `confirm`.
- The question names the kind and the key value when the resource has a key.
- `confirm: false` without `--yes` exits 2, prints the message naming `--yes`, and does not run the handler; fails first. With `--yes`, it runs.
- A program passing `--yes` in its own `globals` is refused at construction.
- `pnpm --filter @cofold/terminal test` is clean.

## Resume

Built 2026-10-06, awaiting review. `--yes` is in `globalOptions`; `confirm` is on `ProgramOptions`; the default asks through `node:readline/promises` when stdin and stderr are both terminals. A `remove` with no resource is said as `<words> removes something`, a wording the plan did not fix. Tests: six cases in `program.test.ts`. By hand under `script`, `petshop pet remove 1` answered `n` exits 1 with `petshop: not run`, answered `y` runs it, with no terminal exits 2 naming `--yes`, and with `--yes` runs it. No consumer in cofold, ahpd, ahpc or Advisor declares `--yes` today.
