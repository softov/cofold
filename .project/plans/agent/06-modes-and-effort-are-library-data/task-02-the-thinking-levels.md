---
title: The thinking levels and their parser are library data
status: todo
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/model.ts#L13-L14](../../../../packages/agents/src/types/model.ts#L13-L14) - `ReasoningEffort`"
  - "[code://packages/agents/src/index.ts#L16-L17](../../../../packages/agents/src/index.ts#L16-L17) - the `model/` exports the new ones join"
  - file:///github/ahpd/packages/agent-cofold/src/agent.ts - lines 146-158, `EFFORT_LEVELS` and `effortOf`
---

## Objective

`@cofold/agents` exports `EFFORT_LEVELS` (`off`, `low`, `medium`, `high`), the type `EffortLevel`, and `effortOf(value)`, which gives the `ReasoningEffort` a level asks for, or `undefined` for `off`, a missing value or anything unknown.

## Files

- `CREATE: packages/agents/src/model/effort.ts` - `EFFORT_LEVELS` and `effortOf`.
- `CREATE: packages/agents/src/model/effort.test.ts` - the cases below.
- `UPDATE: packages/agents/src/types/model.ts:13-14` - `EffortLevel` beside `ReasoningEffort`, with a comment saying the levels are what a host offers and `ReasoningEffort` is what a provider accepts.
- `UPDATE: packages/agents/src/index.ts` - export both.

## Steps

1. Tests first.
2. Write the two; `effortOf` is a membership test, no mapping.

## Validation

- `effortOf('high')` is `high`; `effortOf('off')`, `effortOf(undefined)`, `effortOf('max')` and `effortOf(3)` are `undefined`.
- `pnpm --filter @cofold/agents test` is clean.

## Resume

