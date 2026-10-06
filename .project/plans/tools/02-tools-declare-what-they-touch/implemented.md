---
title: Tools declare what they touch - implemented
date: 2026-10-06
refs:
  - git://1d505a4 - the last commit before this plan's work; everything below is uncommitted on top of it
  - "[code://packages/agents/src/types/tool.ts](../../../../packages/agents/src/types/tool.ts) - `subject` and, beside it, `writes`"
  - "[code://packages/agents/src/types/event.ts](../../../../packages/agents/src/types/event.ts) - `tool.proposed` with `subject?`"
  - "[code://packages/agents/src/policy/modes.ts](../../../../packages/agents/src/policy/modes.ts) - `acceptEdits` and its `isEdit` default"
  - "[code://packages/agents/src/types/capability.ts](../../../../packages/agents/src/types/capability.ts) - `Capability.exclude`"
  - "[code://packages/tools/src/files.ts](../../../../packages/tools/src/files.ts) - the two writers that declare `writes`"
---

Every standard tool says what a call acts on, and each of the three that writes one named file says which file, so a host reads both off the tool instead of keeping a table of tool names.
A host can leave a capability's tool out when it offers its own of that name.

## What was built

- [`code://packages/tools/src/web.ts`](../../../../packages/tools/src/web.ts) - `web_fetch` declares `subject: (input) => input.url`, the URL as asked for, before it is parsed; `web_search` declares `subject: (input) => input.query`.
- [`code://packages/tools/src/memory.ts`](../../../../packages/tools/src/memory.ts) - one `subject(path)` helper over `displayPath(resolveWithin(dir, path).absolute)`, so both memory tools name the file relative to the memory folder with forward slashes and absolute when it leaves; `memory_read` defaults to `MEMORY.md`, and `memory_write` declares `writes` with the same absolute path. It resolves without checking, so the subject is there for a call `execute` is about to refuse.
- [`code://packages/agents/src/types/tool.ts`](../../../../packages/agents/src/types/tool.ts) - `writes?(input): string`, the absolute path of the file a call writes, beside `subject`; the comments say which of `writes` and `effects.writes` is the path and which is the boolean. `createTool` spreads the definition, so nothing else changed there.
- [`code://packages/tools/src/files.ts`](../../../../packages/tools/src/files.ts) - `write_file` and `edit_file` declare `writes: (input) => at(input.path)`.
- [`code://packages/agents/src/types/policy.ts`](../../../../packages/agents/src/types/policy.ts), [`code://packages/agents/src/policy/modes.ts`](../../../../packages/agents/src/policy/modes.ts) - `PermissionModeRules.isEdit` is optional and defaults to `declaresWrites`, a module-level `(tool) => tool.writes !== undefined`; `acceptEdits` reads the path from `args.tool.writes?.(args.input) ?? input.path` and lets the call through when `rules.inside` says the file is in the workspace. `plan`, `auto`, `bypassPermissions` and `dontAsk` never read `writes`.
- [`code://packages/agents/src/types/event.ts`](../../../../packages/agents/src/types/event.ts), [`code://packages/agents/src/run/tools.ts`](../../../../packages/agents/src/run/tools.ts) - `tool.proposed` carries `subject?: string`. `handleToolCall` validates once, before it announces the call, and reuses that result for the two deny branches; the emit spreads `subject` only when it is defined, and `subjectOf(tool, input)` answers `undefined` for a tool that declares none and for one whose `subject` throws. Where in the call the announcement is made was changed by *Review fixes* below: for a call that goes on it now follows the `beforeTool` hook.
- [`code://packages/agents/src/types/capability.ts`](../../../../packages/agents/src/types/capability.ts), [`code://packages/agents/src/run/turn.ts`](../../../../packages/agents/src/run/turn.ts) - `Capability.exclude?: readonly string[]`; `resolveCapabilities` filters the contributed tools before its loop, so the duplicate check and `defer.over` both count what remains. An excluded name the capability does not contribute is ignored.
- [`code://packages/papo/src/agent.ts`](../../../../packages/papo/src/agent.ts) - `EDITS` is gone and `policyOf` is given `{ inside }` alone.
- [`code://packages/agents/README.md`](../../../../packages/agents/README.md), [`code://packages/tools/README.md`](../../../../packages/tools/README.md) - the announcement and its two absences, `subject` beside `writes` with a `write_file` snippet, the `isEdit` default, `Capability.exclude`; a *Subject, `writes`* column on the `files()` table, and the subjects of the shell, web and memory tools with which ones declare `writes`.

## Verified

- `pnpm typecheck` on 2026-10-06: clean in every package and example, no type errors.
- `pnpm test` on 2026-10-06, when the plan was built: 925 tests across 72 files, 924 passed, one failed - `@cofold/store-file`'s "a session folder copied to another root resumes there", the fork this project already carried since agent/05 and not something this plan touched. Type errors: none.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after that test was fixed (Softov's answer, recorded in agent/05's [implemented.md](../agent/05-a-run-answers-its-own-pause/implemented.md)): clean, 937 tests across 74 files, all passed, no type errors.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after the review fixes below: clean, 945 tests across 75 files, all passed, no type errors. `@cofold/agents` 251 tests, `@cofold/tools` 40 across 6 files.
- `@cofold/agents` - 245 tests (was 215). `run/tools.test.ts` covers the subject read from the validated input (the subject reads the defaulted `loud: false`, so it proves which input the tool saw), a tool with no subject emitting no key, an invalid input proposing without a subject and then denying in that order with the tool's `subject` never called, and a throwing subject losing only the field. `run/run.test.ts` covers `exclude`: the agent's `write_file` beside a capability that also contributes one completes, the request offers both names and the step record shows the agent tool ran (dropping the filter fails this case), the same setup without `exclude` still fails `invalid_options` naming the duplicate, and `exclude: ['a']` with `defer: { over: 1 }` over `[a, b, c]` offers `b` and defers `c` (an unfiltered index would offer `a`). `policy/modes.test.ts` covers the `isEdit` default in both directions and that a host `isEdit` is still obeyed.
- `@cofold/tools` - 33 tests across five files. `web.test.ts` feeds the real `web_fetch` subject to a real `rules()` decision and shows one host denied and another allowed; `files.test.ts` checks the absolute write path, a `..` spelling resolved, and that the three read-only tools declare nothing; `memory.test.ts` checks the relative subject, `./notes/../a.md` folded to `a.md`, an escaping path absolute, and `memory_write`'s `writes` with `memory_read`'s absent.
- `@cofold/papo` - 141 tests, unchanged. The `acceptEdits` case still lets an in-workspace `write_file` and `edit_file` through and still asks for an outside write and a `shell_exec`; it passed before this plan too, by design - the point is that the same behaviour now comes from the tools rather than from papo's table, which `policy/modes.test.ts`'s default cases are what prove.
- One run of the full suite timed out on papo's screen `/compact` case at the 5 s limit under load; that file alone and the next full run both passed it (3.8 s), so it is a slow-test flake and not this plan's change.

## Departures from the plan

- Task 02 - `memory_write` declares `writes` as the plan asks, so `acceptEdits` asks about a memory write: its file is never inside the workspace, so the path cannot let it through. Nothing was added to make that special.
- Task 03 - the validation is computed once, as the task asks, but the "not valid JSON" and "failed the schema" branches became two tests of one value rather than a nil check and a schema call; the emitted order (`tool.proposed`, then `tool.denied`) is the same as before.
- Task 06 - only the README half is built. The ahpd half is another repository's work and waits for a cofold release, which this build does not make; it is in [deferred.md](deferred.md).
- The plan's *Final verification checklist* asked for `tool.proposed` to carry `write_file`'s display path and for a host tool beside `{ ...files(), exclude: ['write_file'] }`. Both are proven by composition rather than by one end-to-end test: `run/tools.test.ts` proves `tool.proposed` carries `tool.subject(validated.value)`, `files.test.ts` proves what `write_file.subject` answers, and `run/run.test.ts` uses an ordinary tool of that name rather than `files()` itself.

## Review fixes

Softov's review of this plan found two defects; each is fixed, and each has a test that was run against the code without the fix and fails there.

- **The `tool.proposed` subject was read before `beforeTool` could change the input.** [`code://packages/agents/src/run/tools.ts`](../../../../packages/agents/src/run/tools.ts) computed it from the model's arguments, so a hook's `modify` was announced with the subject of the input that would not run. The announcement for a call that goes on now comes after the hook, and the subject is read from the input the call will run with - validated, defaults filled, `modify` applied. The two deny branches (invalid arguments, a hook `deny` or `stop`) still announce first and deny after, which keeps the pinned order `tool.proposed`, `tool.denied`, `run.finished`. The event's `input` stays the model's arguments as it gave them, and [`code://packages/agents/src/types/event.ts`](../../../../packages/agents/src/types/event.ts) and [`code://packages/agents/README.md`](../../../../packages/agents/README.md) now say exactly that. The case in `run/tools.test.ts` fails with `subject: 'hi'` before the fix.
- **A `writes()` that threw under `acceptEdits` failed the run.** [`code://packages/agents/src/policy/modes.ts`](../../../../packages/agents/src/policy/modes.ts) called it straight out of `policy.decide`, so a host tool's own error ended the turn. A `writes` that throws now names no file, and a call that names no file is a non-edit: it asks, exactly as a tool that declares no `writes` does. The path is read through one helper (`writesOf`), which is also where a tool that declares none falls back to `input.path`; a throw gets no fallback, so the call cannot be let through on a path the tool never confirmed. The case in `policy/modes.test.ts` fails with the `TypeError` escaping `policyOf` before the fix.

## Left for later

- ahpd's three removals, in [deferred.md](deferred.md).
