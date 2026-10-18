---
title: runEntry writes a failure as JSON
status: implemented
depends: []
layer: terminal
refs:
  - "[code://packages/terminal/src/entry.ts#L25-L50](../../../../packages/terminal/src/entry.ts#L25-L50) - the `catch` that writes the line"
  - "[code://packages/commands/src/errors.ts#L13-L43](../../../../packages/commands/src/errors.ts#L13-L43) - `kind` and `exitCode`"
  - "[code://packages/commands/src/errors.ts#L64-L71](../../../../packages/commands/src/errors.ts#L64-L71) - `missing`"
---

## Objective

`failureOf` and `writeFailure` exist in `@cofold/terminal`, and `runEntry` writes a thrown error through them.
Under `--json`, the failure is one flat JSON line on stderr.

## Files

- `CREATE: packages/terminal/src/failure.ts` - `failureOf(error, secrets)` and `writeFailure(io, name, failure, mode)`.
- `CREATE: packages/terminal/src/types/failure.ts` - the `Failure` type.
- `UPDATE: packages/terminal/src/entry.ts:25-50` - the `catch` calls `failureOf` and `writeFailure`.
- `UPDATE: packages/terminal/src/program.ts:112-176` - a read-only `mode` property, set when `run` chooses the mode.
- `UPDATE: packages/terminal/src/index.ts` - export `failureOf`, `writeFailure` and the `Failure` type.
- `CREATE: packages/terminal/src/entry.test.ts` - the cases in Validation.

## Steps

1. Write the tests first.
2. Write `failureOf`: the redacted message, the `kind`, `exitCodeFor(error)`, and `missing` for an `AuthorizationError`.
3. Give an error that is not a `CofoldError` the kind `internal`.
4. Write `writeFailure`: one JSON line on stderr in `json` mode, else `<name>: <message>`.
5. Set `Program.mode` when `run` chooses the mode.
6. In `runEntry`, take the mode from `program.mode`, else from a literal `--json` before `--`.
7. Keep the `COFOLD_TRACE` stack as plain text after the failure.
8. Set this task and the plan row to `implemented`.

## Validation

- A test: a thrown `ArgumentError` under `--json` writes `{"message":...,"kind":"argument","exitCode":2}` and exits 2.
- A test: an `AuthorizationError` with scopes writes `missing`.
- A test: a plain `Error` writes the kind `internal` and exits 1.
- A test: a secret in the message is `[redacted]` in the JSON.
- A test: without `--json`, the line is the same as before.
- `pnpm -r typecheck` and the `@cofold/terminal` tests pass.

## Resume

Implemented 2026-10-18.
`failureOf`, `writeFailure`, `jsonRequested` and `redact` live in `packages/terminal/src/failure.ts`; `Failure` lives in `packages/terminal/src/types/failure.ts`.
`redact` moved from `entry.ts` to `failure.ts` so the plain line and the JSON share one definition; `entry.ts` re-exports it.
`runEntry` takes `program.mode`, else a literal `--json` before `--`, and keeps the `COFOLD_TRACE` stack as plain text after the JSON line.
`entry.test.ts` covers the five cases in Validation, the literal fallback, the `--` boundary and the stack.
Checks: `pnpm build`, `pnpm typecheck` and `pnpm test` (79 files, 1067 tests) passed.
