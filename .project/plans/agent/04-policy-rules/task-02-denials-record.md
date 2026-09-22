---
title: Every denial is on the run record and the outcome
status: done
depends: [task-01-decide-and-precedence.md]
layer: agents
refs:
  - code://packages/agents/src/types/store.ts#L30-L44,L147 - `RunRecord`, `runs.update`
  - code://packages/agents/src/run/tools.ts#L16-L19 - the `deny` helper
  - code://packages/agents/src/run/turn.ts#L259-L263 - the `max_tool_calls` denial
  - code://packages/agents/src/run/turn.ts#L304-L319 - the user's deny and the declined input in `applyResolved`
  - code://packages/agents/src/run/turn.ts#L128-L137 - `finishRun`; `pause` at L325-L335
  - code://packages/agents/src/run/resume.ts#L207-L222 - `countersOf`
  - code://packages/agents/src/store/memory.ts#L119-L130 - `update`
  - code://packages/agents/src/testing/store-conformance.ts#L176-L190 - the `update` cases
---

## Objective

`RunRecord.denials` lists every refused call with why and by whom, and every outcome carries the same list (cli/03 F3; Claude's `permission_denials` is "the authoritative record").

## Files

- `UPDATE: packages/agents/src/types/store.ts:30-44,147` - `Denial`, `RunRecord.denials`, `update({ denials? })`.
- `UPDATE: packages/agents/src/types/outcome.ts` - `denials?: Denial[]` on every variant.
- `UPDATE: packages/agents/src/types/turn.ts` - `ToolCallDeps.denied(denial)`, `TurnContext.counters.denials`.
- `UPDATE: packages/agents/src/run/tools.ts:16-19` - the `deny` helper takes `by`.
- `UPDATE: packages/agents/src/run/turn.ts:119-137,259-263,304-319,325-335` - `tally()`, the limit and user denials, `finishRun` / `pause` writing `denials`.
- `UPDATE: packages/agents/src/run/run.ts:78`, `packages/agents/src/run/resume.ts:207-222` - counters start empty; `countersOf` reads `record.denials`.
- `UPDATE: packages/agents/src/store/memory.ts:119-130`, `packages/store-file/src/store.ts:160-171` - persist `denials`.
- `UPDATE: packages/agents/src/testing/store-conformance.ts:176-190` - round trip.
- `CREATE: packages/agents/src/run/denials.test.ts`.

## Steps

1. `types/store.ts`:

   ```ts
   /** One refused tool call (cli/03 F3). `by` says who refused: the policy, a hook, the person, the validator or a limit. */
   export interface Denial { callId: string; name: string; input: unknown; reason: string; by: 'policy' | 'hook' | 'user' | 'invalid' | 'limit' }
   ```

   `RunRecord.denials: Denial[]` (required; `runs.create` starts it at `[]`); `update(args: ... & { denials?: Denial[] })`. `types/outcome.ts`: `denials?: Denial[]` after `usage` on each variant.

2. `ToolCallDeps` gains `denied: (denial: Denial) => void` (the loop pushes into `ctx.counters.denials`); `TurnContext.counters.denials: Denial[]`. In `tools.ts` the helper becomes `deny(reason, by)`: unknown tool, not JSON and schema failure pass `'invalid'`; the hook's deny and stop pass `'hook'`; the policy's deny passes `'policy'`; each calls `deps.denied({ callId, name, input: call.input, reason, by })` before emitting `tool.denied`. In `turn.ts`: the `max_tool_calls` branch records `by: 'limit'`; `applyResolved` records `by: 'user'` for a denied approval (`reason: command.reason ?? 'Denied by the user'`) and for a declined input.

3. `tally(ctx)` returns `{ usage, steps, cost?, denials }` (the `cost` part lands with p5 task 07; until then `{ usage, steps, denials }`) and replaces the hand-written `usage: counters.usage, steps: counters.steps` in every outcome literal of `turn.ts`, `run.ts`, `resume.ts`, `fail()` and `abortOutcome()`. `finishRun` and `pause` pass `denials: outcome.denials` to `runs.update`. `countersOf` returns `denials: record.denials` for both the paused and the dead run (the record is written at every denial through the next `update`; a dead run's denials before its last update are in the events, which is the accepted loss).

4. Stores: `memory.ts` `update` copies `denials` when given; the file store writes it into `run.json`; a record read from disk without the field (written before this task) reads back with `denials: []`. Conformance: `update({ denials: [one] })` reads back equal; `create` without it reads back `[]`.

5. `denials.test.ts`: a run with an unknown tool, a schema failure, a hook deny, a policy deny and a `max_tool_calls` hit lists five denials in order with the right `by`; the outcome's list equals the record's; a paused run denied by the user records `by: 'user'` and `resume()` carries the list; a run with no denial records `[]`.

## Validation

- `pnpm check` (conformance runs against both stores).

## Resume

Built 2026-09-16, after agent/01-p5 task 07 (its `tally()` is reused, not re-introduced).

- Contracts: `types/store.ts` `Denial { callId, name, input, reason, by }`, `RunRecord.denials: Denial[]` (required; `runs.create` starts it at `[]`), `runs.update({ denials? })`; `types/outcome.ts` `RunTally.denials?: Denial[]`, so every `RunOutcome` variant carries it through the one intersection p5 task 07 introduced; `types/turn.ts` `ToolCallDeps.denied(denial)`, `TurnContext.counters.denials`.
- `run/tools.ts`: `deny(reason, by)` records through `deps.denied` before `tool.denied`; `invalid` for an unknown tool, arguments that are not JSON, a schema failure and a failed hook modify; `hook` for the hook's deny and stop; `policy` for a `deny` decision.
- `run/turn.ts`: `deps.denied` pushes into `counters.denials`; the `max_tool_calls` branch records `by: 'limit'` with the reason the model reads (`Tool call limit reached`); `applyResolved` records `by: 'user'` for a denied approval (`command.reason ?? 'Denied by the user'`, the input from the request payload) and a declined question (the decline text); `tally()` returns `{ usage, steps, cost?, denials }` with a copy of the list; `finishRun` and `pause` pass it to `runs.update`.
- `run/run.ts`: counters start with `denials: []`, `runs.create` writes `denials: []`, the setup-failure outcome carries `denials: []`. `run/resume.ts`: `countersOf` returns a copy of `record.denials` for both the paused and the dead run; the three detached failure outcomes carry `record.denials` (and `record.cost` when present).
- Stores: `store/memory.ts` and `store-file/src/store.ts` `update` write `denials` when given; the file store's `readRun` fills `denials: []` for a `run.json` written before this task. Conformance gained "persists denials: [] from create, the list written by update", proven on both stores; the `runRecord` helpers of the conformance suite and `store-file/src/store.test.ts` default `denials: []`.
- Tests: `run/denials.test.ts` (6: validator, hook, policy and limit refusals in order with the right `by` on the outcome and the record; a raw non-JSON call; a hook stop; the person's deny through `resume()` with the outcome, the record and a later `resume()` agreeing; a declined input; no refusal records `[]` and a paused run's list is carried on); `contracts.test-d.ts` gained the `Denial['by']` / `RunRecord.denials` / `RunTally.denials` case; `run/tools.test.ts` (`setup()` supplies `denied` and exposes `denials`), `run/resume.test.ts` and `run/cost.test.ts` adjusted for the required field and the outcome shape.
- README: `@doopx/agents` (the denial record under the loop description; `deny` records `by: 'user'`).

Evidence: full `pnpm check` green on 2026-09-16 (67 test files, 745 tests, no type errors); `@doopx/agents` alone 20 files, 200 tests.

Deviations and findings:
- `packages/agents/src/run/tools.test.ts` (agent/04 task 01's file) and `packages/papo/src/turns.test.ts:15` each needed `denials` added to a literal that builds the changed contract (`ToolCallDeps`, `RunRecord`); nothing else in papo changed.
- The user's deny of an approval records the request payload's input (the validated call input), not `call.input`, so an edited input shows what was refused.
- A refusal's `input` for a call whose arguments were not JSON is `undefined`, as `ToolCallPart.input` is; the record keeps the reason.
