---
title: A failure has a JSON shape under --json
domain: commands
status: planned
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
refs:
  - "[code://packages/terminal/src/entry.ts#L25-L50](../../../../packages/terminal/src/entry.ts#L25-L50) - `runEntry` writes `<name>: <sentence>` on stderr in every output mode"
  - "[code://packages/terminal/src/program.ts#L112-L200](../../../../packages/terminal/src/program.ts#L112-L200) - `Program.run` writes five failures itself and returns their exit code"
  - "[code://packages/terminal/src/program.ts#L176](../../../../packages/terminal/src/program.ts#L176) - where the output mode is chosen, after three of the five failures"
  - "[code://packages/commands/src/errors.ts#L13-L43](../../../../packages/commands/src/errors.ts#L13-L43) - `CofoldError`, its `kind` and the exit code of each kind"
  - "[code://packages/commands/src/errors.ts#L64-L71](../../../../packages/commands/src/errors.ts#L64-L71) - `AuthorizationError.missing`, the scopes a caller can act on"
  - "[code://packages/commands/src/errors.ts#L79-L81](../../../../packages/commands/src/errors.ts#L79-L81) - `exitCodeFor`"
  - "[code://packages/remote/src/serve.ts#L133-L135](../../../../packages/remote/src/serve.ts#L133-L135) - a served failure answers `{ message }`, the shape to extend"
  - "[code://packages/terminal/src/index.ts](../../../../packages/terminal/src/index.ts) - the package exports"
  - "[code://docs/commands/05-output.md#L21-L45](../../../../docs/commands/05-output.md#L21-L45) - the manual section on a failure"
---

## Goal

Under `--json`, a program built on `@cofold/terminal` writes each failure as one JSON line, with the sentence, the kind and the exit code.
A script that runs `<program> --json ...` then reads a failure as data, as it reads a result.
Without `--json`, a failure stays one `<name>: <sentence>` line.
The first consumer is ahpd, which bumps the dependency in its own plan daemon/32.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "io.err|stderr.write" packages/terminal/src` - `runEntry` writes one failure, and `Program.run` writes five.
- `rg -n "runEntry" packages/terminal/src` - no test covers `runEntry`.
- `rg -n "json\(status" packages/remote/src` - a served failure has the body `{ message }`.

### Runtime path

```
bin -> runEntry -> Program.run -> parse -> mode -> registry.execute -> throw -> runEntry catch -> stderr line -> exit code
```

### What is true now

- `runEntry` does not know the output mode, because `Program.run` parses the arguments and keeps the mode to itself.
- Three failures in `Program.run` come before the mode is chosen: `--json` with `--quiet`, a command that needs a slot, and an unknown command.
- The manual names `FACIO_TRACE`, and `runEntry` reads `COFOLD_TRACE`.

### Gaps

- No failure has a JSON shape.
- No function lets a program write a failure in the same shape before `runEntry` runs.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every failure that `runEntry` and `Program.run` write takes the shape under `--json` | (defaulted: the idea asks for every failure, the group hint included) | 01, 02 |
| The JSON has `message`, `kind` and `exitCode`, and `missing` for an authorization failure | (defaulted: the idea names the three, and `missing` is on the error for a caller that is not a terminal) | 01 |
| An unexpected error has the kind `internal` | (defaulted: `exitCodeFor` already gives it exit 1) | 01 |
| The message is redacted before it is put in the JSON | (defaulted: the same redaction as the line) | 01 |
| A failure before the parse finds `--json` as a literal word before `--` | (defaulted: the parse can fail before it gives a mode) | 02 |
| `failureOf(error, name)` and `writeFailure(...)` are exported, so a program writes the same shape before `runEntry` | (defaulted: ahpd writes failures in `main.ts` before `runEntry`) | 01 |
| `--json` with `--quiet` keeps the plain line | (defaulted: the run has no single mode) | 02 |
| The stack under `COFOLD_TRACE` stays plain text, after the JSON line | (defaulted: a stack is for a person) | 01 |
| Softov publishes the release | the idea, 2026-09-26 | 04 |
| A JSON failure goes to stderr, so stdout holds only the result | Softov, 2026-10-16, chose the recommended answer for "Which stream gets the JSON failure?" | 01, 02 |
| The JSON is flat: `{ message, kind, exitCode }`, plus `missing` | Softov, 2026-10-16, chose the recommended answer for "Is the JSON flat or wrapped?" | 01 |

## Proposed architecture

- **Data flow** - an error goes to `failureOf`, which gives `{ message, kind, exitCode, missing? }`. `writeFailure` writes it as one JSON line in `json` mode, else as the line of today.
- **Mode** - `Program` keeps the mode of its latest run in a read-only property. `runEntry` reads it in its `catch`, else looks for a literal `--json`.
- **Stream** - stderr, in every mode.
- **Shape** - flat, as the `{ message }` body of `@cofold/remote` is.
- **Layer responsibilities** - `@cofold/terminal`: the shape, the mode and the writer. `@cofold/commands`: nothing changes. `@cofold/remote`: nothing changes.
- **Source-of-truth files** - [`code://packages/terminal/src/entry.ts`](../../../../packages/terminal/src/entry.ts), [`code://packages/terminal/src/program.ts`](../../../../packages/terminal/src/program.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - runEntry writes a failure as JSON](task-01-run-entry-writes-a-failure-as-json.md) | todo | - |
| [02 - Program.run writes its failures as JSON](task-02-program-run-writes-its-failures-as-json.md) | todo | 01 |
| [03 - The manual shows a failure under --json](task-03-the-manual-shows-a-failure-under-json.md) | todo | 01, 02 |
| [04 - Release @cofold/terminal](task-04-release-cofold-terminal.md) | todo | 03 |

## Risks and tradeoffs

- A script that greps the `<name>:` line under `--json` breaks - The release is a minor version, and the manual names the change.
- A secret in the message reaches the JSON - The message goes through `redact` first, and a test proves it.

## Resume state

- **Done so far:** the plan, 2026-10-16. Softov answered the open questions on 2026-10-16.
- **Next action:** [task-01-run-entry-writes-a-failure-as-json.md](task-01-run-entry-writes-a-failure-as-json.md).
- **Open questions:** none.
- **Watch out for:** `Program.run` returns a code for three failures and throws for the others. Both paths must write the same shape.

## Final verification checklist

- [ ] `pnpm -r typecheck` and the `@cofold/terminal` tests pass.
- [ ] `<program> --json` with an unknown command, a missing slot and a thrown error each write one JSON line.
- [ ] Without `--json`, each failure writes the line of today.
- [ ] ahpd daemon/32 builds against the release.
- [ ] `plans/index.md` updated.
