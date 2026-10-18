---
title: Program.run writes its failures as JSON
status: implemented
depends:
  - task-01-run-entry-writes-a-failure-as-json.md
layer: terminal
refs:
  - "[code://packages/terminal/src/program.ts#L122-L124](../../../../packages/terminal/src/program.ts#L122-L124) - `--json` with `--quiet`"
  - "[code://packages/terminal/src/program.ts#L165-L172](../../../../packages/terminal/src/program.ts#L165-L172) - a missing slot and an unknown command"
  - "[code://packages/terminal/src/program.ts#L193-L202](../../../../packages/terminal/src/program.ts#L193-L202) - a removal without `--yes`, and a removal that the person refused"
  - "[code://packages/terminal/src/program.test.ts](../../../../packages/terminal/src/program.test.ts) - the tests of `run`"
---

## Objective

The five failures that `Program.run` writes itself go through `writeFailure`, so each one has the JSON shape under `--json`.
The exit codes stay as they are.

## Files

- `UPDATE: packages/terminal/src/program.ts:122-124` - `--json` with `--quiet` writes an argument failure.
- `UPDATE: packages/terminal/src/program.ts:165-172` - a missing slot and an unknown command write argument failures.
- `UPDATE: packages/terminal/src/program.ts:193-202` - the two removal failures write a failure.
- `UPDATE: packages/terminal/src/program.test.ts` - the cases in Validation.

## Steps

1. Write the tests first.
2. For the three failures before the mode, look for a literal `--json`.
3. Give `--json` with `--quiet` the plain line, because the mode is not one of the two.
4. Write a missing slot and an unknown command as argument failures, with the usage in the message.
5. Write a removal without `--yes` as an argument failure, and a refused removal as a conflict.
6. Keep each return code as it is now.
7. Set this task and the plan row to `implemented`.

## Validation

- A test: `--json` with an unknown command writes one JSON line with the kind `argument` and returns 2.
- A test: `--json` with a missing slot writes the usage in `message`.
- A test: `--json` on a removal without a terminal writes one JSON line and returns 2.
- A test: each failure without `--json` writes the line of today.
- `pnpm -r typecheck` and the `@cofold/terminal` tests pass.

## Resume

Implemented 2026-10-18.
The five failures in `Program.run` go through `writeFailure`.
`--json` with `--quiet` keeps the plain line.
The missing slot and the unknown command look for a literal `--json`.
The two removal failures use the chosen mode.
Each keeps its exit code: 2, 2, 2, 2 and 1.
`Program.mode` resets at the start of each run and is set when the mode is chosen.
`program.test.ts` covers the JSON lines and keeps the plain-line tests.
Checks: `pnpm build`, `pnpm typecheck` and `pnpm test` (79 files, 1067 tests) passed.
