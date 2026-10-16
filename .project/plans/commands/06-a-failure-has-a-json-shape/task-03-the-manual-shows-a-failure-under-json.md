---
title: The manual shows a failure under --json
status: todo
depends:
  - task-01-run-entry-writes-a-failure-as-json.md
  - task-02-program-run-writes-its-failures-as-json.md
layer: docs
refs:
  - "[code://docs/commands/05-output.md#L21-L45](../../../../docs/commands/05-output.md#L21-L45) - the section on a failure"
  - "[code://packages/terminal/README.md](../../../../packages/terminal/README.md) - the package page"
---

## Objective

The `Failure` section of the manual shows the JSON shape, the stream, and `writeFailure` for a program that fails before `runEntry`.

## Files

- `UPDATE: docs/commands/05-output.md:21-45` - the JSON shape, an example, and `failureOf` and `writeFailure`.
- `UPDATE: packages/terminal/README.md` - one line on a failure under `--json`.

## Steps

1. Add an example of a failure under `--json` after the table of kinds.
2. Name the stream and the fields.
3. Show `writeFailure` for a failure that a program writes before `runEntry`.
4. Change `FACIO_TRACE` to `COFOLD_TRACE`, the name that `runEntry` reads.
5. Set this task and the plan row to `implemented`.

## Validation

- The example in the manual is the output of a test in task 01.
- `rg -n FACIO_TRACE docs packages` finds nothing.

## Resume
