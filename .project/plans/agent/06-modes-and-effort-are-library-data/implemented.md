---
title: Permission modes and reasoning effort are library data - implemented
date: 2026-10-06
refs:
  - git://1d505a4 - the last commit before this plan's work; everything below is uncommitted on top of it
  - "[code://packages/agents/src/policy/modes.ts](../../../../packages/agents/src/policy/modes.ts) - `PERMISSION_MODES` and `PERMISSION_MODE_DESCRIPTIONS` above `policyOf`"
  - "[code://packages/agents/src/model/effort.ts](../../../../packages/agents/src/model/effort.ts) - `EFFORT_LEVELS` and `effortOf`"
  - "[code://packages/model-openai-compat/src/index.ts](../../../../packages/model-openai-compat/src/index.ts) - the features a model is built with, and the feature a reasoning param switches on"
  - "[code://packages/papo/src/types/settings.ts](../../../../packages/papo/src/types/settings.ts) - papo's two lists, taken from the harness's"
  - "[code://packages/papo/src/agent.ts](../../../../packages/papo/src/agent.ts) - the level becoming `params.reasoning` through `effortOf`"
---

A host draws the permission modes with what each one does, and the thinking levels with their parser, from `@cofold/agents`, and keeps only its own labels.
A model given `params.reasoning` has `features.reasoning` on, which is what a host's effort setting needs to reach the request at all.

## What was built

- [`code://packages/agents/src/policy/modes.ts`](../../../../packages/agents/src/policy/modes.ts) - `PERMISSION_MODES` (the six, in a fixed order, `as const satisfies readonly PermissionMode[]`) and `PERMISSION_MODE_DESCRIPTIONS` (one sentence per mode, saying what `policyOf` does with it), both exported from `index.ts`.
- [`code://packages/agents/src/model/effort.ts`](../../../../packages/agents/src/model/effort.ts) - `EFFORT_LEVELS` (`off`, `low`, `medium`, `high`) and `effortOf(value)`, a membership test giving the `ReasoningEffort` a level asks for and `undefined` for `off`, a missing value or anything unknown; `EffortLevel` sits in `types/model.ts` beside `ReasoningEffort`, and both names are exported from `index.ts`.
- [`code://packages/model-openai-compat/src/index.ts`](../../../../packages/model-openai-compat/src/index.ts) - `model(args)` builds its features as `{ ...DEFAULT_FEATURES, ...(args.params?.reasoning !== undefined ? { reasoning: true } : {}), ...args.features }`: a reasoning param turns the feature on, and `features: { reasoning: false }` still turns it off. The gate that sends the field is unchanged.
- [`code://packages/papo/src/types/settings.ts`](../../../../packages/papo/src/types/settings.ts), [`code://packages/papo/src/config.ts`](../../../../packages/papo/src/config.ts), [`code://packages/papo/src/commands.ts`](../../../../packages/papo/src/commands.ts) - `Reasoning` is `EffortLevel`, `REASONING_LEVELS` is `EFFORT_LEVELS`, `PERMISSION_MODES` is the harness's list filtered to the four papo offers, and the two JSON Schema enums and the two option enums are built from those lists rather than written out again.
- [`code://packages/papo/src/agent.ts`](../../../../packages/papo/src/agent.ts) - `const effort = effortOf(settings.reasoning)` and `reasoning: { effort }` spread only when it is defined.
- [`code://packages/agents/README.md`](../../../../packages/agents/README.md), [`code://packages/model-openai-compat/README.md`](../../../../packages/model-openai-compat/README.md) - the modes with `policyOf` in *Rules*, the levels with `effortOf` in *Models and providers*, and the adapter's `params` row saying what a reasoning param does to its features.

## Verified

- `pnpm typecheck` on 2026-10-06: clean in every package and example, no type errors.
- `pnpm test` on 2026-10-06, when the plan was built: 912 tests across 72 files, 911 passed, one failed - `@cofold/store-file`'s "a session folder copied to another root resumes there", the fork this project already carried and not something this plan touched. Type errors: none.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after that test was fixed (Softov's answer, recorded in agent/05's [implemented.md](../05-a-run-answers-its-own-pause/implemented.md)): clean, 937 tests across 74 files, all passed, no type errors.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after the review fixes recorded in agent/05's and tools/02's implemented.md: clean, 945 tests across 75 files, all passed, no type errors.
- `@cofold/agents` - 215 tests. `effort.test.ts` covers the three levels, `off`, a missing value, `null` and the unknown strings and numbers; `modes.test.ts` covers the order, no duplicates and a description per mode. `types/contracts.test-d.ts` pins `Exclude<PermissionMode, (typeof PERMISSION_MODES)[number]>` and `Exclude<EffortLevel, (typeof EFFORT_LEVELS)[number]>` to `never`, and `effortOf`'s parameter to `unknown` and its return to `ReasoningEffort | undefined`.
- `@cofold/model-openai-compat` - 70 tests. The adapter case asserts the param turns the feature on and `reasoning_effort: 'high'` reaches the body, that an explicit `features: { reasoning: false }` leaves both off, and that a model with no param is still `features.reasoning === false`. Reverting the expression to `{ ...DEFAULT_FEATURES, ...args.features }` fails exactly that case.
- `@cofold/papo` - 141 tests. The new case drives a real `openaiCompatProvider` over a stub fetch answering server-sent events and asserts `reasoning_effort: 'high'` in the posted body, then no `reasoning` or `reasoning_effort` after `reasoning: 'off'`. Reverting task 03 and rebuilding the adapter fails exactly that case, so the level is proven to travel the whole path. `config.test.ts` still refuses `permissions: 'plan'`, `permissions: 'auto'` and `reasoning: 'max'`, each naming the key.

## Departures from the plan

- Task 02 - the type assertion lives in `src/types/contracts.test-d.ts`, as task 01's did, because a `*.test-d.ts` is this project's place for one. As recorded in task 01, running `vitest --typecheck` inside the package directory does not report it; `tsc -p tsconfig.test.json` and the root `vitest run --typecheck --project @cofold/agents` do.
- Task 03 - the change and its test were written in the same round rather than the test first. Non-vacuity was checked afterwards by reverting the expression and re-running: exactly the one new case fails, nothing else.
- Task 04 - `PERMISSION_MODES` is `HARNESS_PERMISSION_MODES.filter((mode): mode is PermissionMode => OFFERED_MODES.has(mode))`, where `OFFERED_MODES` names papo's four, rather than dropping `plan` and `auto` from the shared list. Same four in the same order, but a mode the harness adds later cannot leak into papo's choices by itself. The task file's `commands.ts:26` is the `--reasoning` option; the `permissions` option on the line above it was built from the list too, which is what the plan's *Decisions locked in* row asks for ("its schema and option enums are built from them").
- Task 05 - only the README half is built. The ahpd half is another repository's work and waits for a cofold release; it is in [deferred.md](deferred.md) rather than opened here.

## Left for later

- ahpd replaces its copies and drops the forced `features.reasoning` (task 05) - in [deferred.md](deferred.md).
