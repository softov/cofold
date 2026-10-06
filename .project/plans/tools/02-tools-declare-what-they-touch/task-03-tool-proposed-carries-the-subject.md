---
title: tool.proposed carries the subject
status: todo
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

