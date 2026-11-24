---
title: A part has a start and an end
status: todo
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/message.ts#L3-L31](../../../../packages/agents/src/types/message.ts#L3-L31) - the content parts"
---

## Objective

Each content part type has optional `startedAt` and `endedAt`, as ISO 8601 strings.

## Files

- `UPDATE: packages/agents/src/types/message.ts:3-31` - add the two optional fields to each part, through one shared type.
- `UPDATE: packages/agents/src/types/contracts.test-d.ts` - the fields are on every part.

## Steps

1. Add a `PartTimes` type with optional `startedAt` and `endedAt`.
2. Add `PartTimes` to `TextPart`, `ImagePart`, `ReasoningPart`, `ToolCallPart` and `ToolResultPart`.
3. Check that the context builder sends neither field to a model.
4. Add a type case: each part type has the two fields.

## Validation

- `contracts.test-d.ts`: the new case.
- `pnpm --filter @cofold/agents test` passes.

## Resume
