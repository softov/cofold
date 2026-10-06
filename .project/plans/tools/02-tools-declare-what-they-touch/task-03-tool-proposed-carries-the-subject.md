---
title: tool.proposed carries the subject
status: done
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/event.ts#L22](../../../../packages/agents/src/types/event.ts#L22) - `tool.proposed`"
  - "[code://packages/agents/src/run/tools.ts#L23-L31](../../../../packages/agents/src/run/tools.ts#L23-L31) - the emit, then the validation"
---

## Objective

`tool.proposed` carries `subject?: string`, what the call acts on, so a host draws it without knowing the tool.

## Files

- `UPDATE: packages/agents/src/types/event.ts:22` - `subject?: string` with a one-line comment.
- `UPDATE: packages/agents/src/run/tools.ts:23-31` - validate first; the emit spreads `subject` when the tool has one, the input validated, and `tool.subject(validated.value)` did not throw; the denies for invalid input follow the emit as today.
- `UPDATE: packages/agents/src/run/tools.test.ts` - the cases below.

## Steps

1. Tests first.
2. Compute the validation once and reuse it for the deny branches.

## Validation

- A `write_file` call: `tool.proposed.subject` is the display path.
- A tool without `subject`: no `subject` key.
- An invalid input: `tool.proposed` without `subject`, then `tool.denied`, in that order.
- A `subject` that throws: `tool.proposed` without `subject`, and the call goes on.
- `pnpm --filter @cofold/agents test` is clean.

## Resume

- **Built:** `tool.proposed` is now `{ callId, name, input, subject? }` in `types/event.ts`, with a comment naming the source of the subject. `handleToolCall` validates once, before it announces the call: `validated` is computed from `call.input` (or left `undefined` when the arguments did not parse) and reused by the two deny branches, which follow the emit as before. `subjectOf(tool, input)` in `run/tools.ts` answers the tool's `subject` over the validated value, `undefined` when the tool names none; a `subject` that throws is caught there and loses only the field. The emit spreads `subject` conditionally, since `exactOptionalPropertyTypes` is on.
- **Validation:** `run/tools.test.ts` has four new cases: the subject is read from the validated input (the subject reads the defaulted `loud: false`, so it proves which input the tool saw); a tool with no `subject` emits no key; an input that does not validate emits `tool.proposed` (no subject, and the tool's `subject` is never called) then `tool.denied`, in that order; a `subject` that throws emits no key and the call still runs to `tool.completed`.
- **Checks:** `pnpm --filter @cofold/agents exec vitest run --typecheck` 242 pass (was 238), 23 files, no type errors. No other file reads `tool.proposed` (searched `packages`, `examples`, `docs`).

