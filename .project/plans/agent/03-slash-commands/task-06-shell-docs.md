---
title: The shell lists commands, loses the compact action, and the docs say internal and external
status: todo
depends: [task-04-service.md]
layer: papo
refs:
  - code://packages/papo/src/commands.ts
  - code://packages/papo/README.md
---

## Objective

`papo commands` prints the runtime's list; `papo compact <id>` is gone (`papo say -s <id> /compact` is the way, as on the CLI); the README names internal and external commands; cli/02 and cli/00 are corrected.

## Files

- `UPDATE: packages/papo/src/commands.ts` - delete the `compact` action; add `commands` (group Setup, beside `skills`); the help text says a `/name` goes through `say`.
- `UPDATE: packages/papo/src/commands.test.ts` - `papo commands`; `say -s <id> /compact` prints the notice.
- `UPDATE: packages/papo/README.md` - a "Commands" section: internal (the runtime's; the list per backend) and external (the client's); "The screen" and "The shell" corrected; the claude backend section drops the `autoCompact` sentence.
- `UPDATE: .project/plans/cli/02-papo-commands/plan.md` - the decisions table corrected: the internal ones point here.
- `UPDATE: .project/plans/cli/00-cli.md`.

## Steps

1. The `commands` action: `output(list, table)` with name, argument hint, description.
2. README and plan corrections.

## Validation

- `commands.test.ts`; `pnpm check`.

## Resume

