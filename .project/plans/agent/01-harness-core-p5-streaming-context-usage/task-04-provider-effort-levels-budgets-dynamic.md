---
title: Provider: effort levels, budgets, dynamic key, cache key
status: todo
depends: [task-03-stop-beforetool-aftertool.md]
layer: agents
---

## Objective

Provider: effort levels, budgets, dynamic key, cache key.

## Files

- `UPDATE: packages/model-openai-compat/src/index.ts`, `src/wire.ts`, `src/wire.test.ts`, `src/index.test.ts`, `UPDATE: packages/agents/src/run/turn.ts` (`assembleRequest` sets `cacheKey: sessionId`), `packages/agents/src/run/context.ts` (signature), `UPDATE: packages/model-openai-compat/README.md`.

## Steps

- `index.ts`:
  ```ts
  apiKey?: string | (() => string | Promise<string>);
  /** Token budget per effort, for providers that take max_tokens instead of a level (decision 98). */
  reasoningBudgets?: Partial<Record<ReasoningEffort, number>>;
  ```
  `send`: `const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey;` inside the attempt loop; `headers` built per attempt (`{ ...baseHeaders, ...(key ? { authorization: \`Bearer ${key}\` } : {}) }`). The request body gains `prompt_cache_key: request.cacheKey`.
- `wire.ts`:
  ```ts
  export function toWireReasoning(reasoning: NonNullable<ModelParams['reasoning']>, budgets: Partial<Record<ReasoningEffort, number>> = {}): Record<string, unknown> {
    if (reasoning.maxTokens !== undefined) return { reasoning: { ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}), max_tokens: reasoning.maxTokens } };
    const budget = reasoning.effort !== undefined ? budgets[reasoning.effort] : undefined;
    if (budget !== undefined) return { reasoning: { max_tokens: budget } };
    return reasoning.effort !== undefined ? { reasoning_effort: reasoning.effort } : {};
  }
  ```
- Tests: `wire.test.ts` covers the three branches and every effort value; `index.test.ts` with an injected `fetch`: the key function is called once per attempt (`auth` is not retried under decision 32, so a 401 means one call; a 500-then-200 sequence means two calls), `prompt_cache_key` equals the request's `cacheKey`.

## Validation

- `pnpm check`; `examples/agents/adapter-smoke.ts` gains a `--effort xhigh` flag and prints the wire body against the injected fetch.

## Resume


