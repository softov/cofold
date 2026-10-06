---
title: A reasoning param turns reasoning on
status: todo
depends: []
layer: "model-openai-compat"
refs:
  - "[code://packages/model-openai-compat/src/index.ts#L15-L23](../../../../packages/model-openai-compat/src/index.ts#L15-L23) - `openaiCompat` passes `params` and `features` through to `model()`"
  - "[code://packages/model-openai-compat/src/index.ts#L101-L102](../../../../packages/model-openai-compat/src/index.ts#L101-L102) - the features of a model"
  - "[code://packages/model-openai-compat/src/index.ts#L123](../../../../packages/model-openai-compat/src/index.ts#L123) - the gate"
  - "[code://packages/model-openai-compat/src/index.test.ts#L128-L135](../../../../packages/model-openai-compat/src/index.test.ts#L128-L135) - the reasoning tests, which set `features: { reasoning: true }`"
---

## Objective

A model built with `params.reasoning` has `features.reasoning` on, so the effort reaches the request body; `features: { reasoning: false }` still turns it off.

## Files

- `UPDATE: packages/model-openai-compat/src/index.ts:102` - `{ ...DEFAULT_FEATURES, ...(args.params?.reasoning !== undefined ? { reasoning: true } : {}), ...args.features }`.
- `UPDATE: packages/model-openai-compat/src/index.test.ts` - the cases below.
- `UPDATE: packages/model-openai-compat/README.md` - one line on the default.

## Steps

1. Tests first.
2. Change the one expression.

## Validation

- `openaiCompat({ ..., params: { reasoning: { effort: 'high' } } })` with no features: the body has `reasoning`; fails first without it.
- The same with `features: { reasoning: false }`: no `reasoning` in the body.
- No params: `features.reasoning` is `false`, as `index.test.ts:60` expects.
- `pnpm --filter @cofold/model-openai-compat test` is clean.

## Resume

