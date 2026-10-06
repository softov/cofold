---
title: The providers configuration is in model-openai-compat
status: done
depends: []
layer: "model-openai-compat"
refs:
  - "[code://packages/papo/src/config.ts#L12-L22](../../../../packages/papo/src/config.ts#L12-L22) - `PROVIDER`, moved as `PROVIDER_SCHEMA`"
  - "[code://packages/papo/src/config.ts#L220-L253](../../../../packages/papo/src/config.ts#L220-L253) - `providersOf`, `splitModel`, `providerFor`, the code and messages to start from"
  - "[code://packages/papo/src/config.test.ts#L170-L185](../../../../packages/papo/src/config.test.ts#L170-L185) - their tests, which move here"
  - "[code://packages/model-openai-compat/src/index.ts#L1-L9](../../../../packages/model-openai-compat/src/index.ts#L1-L9) - imports and type exports"
  - file:///github/ahpd/packages/agent-cofold/src/config.ts - lines 116-129, `splitModel` returning `undefined`
---

## Objective

`@cofold/model-openai-compat` exports `ProviderConfig`, `PROVIDER_SCHEMA`, `providersOf`, `splitModel` and `providerFor` as the plan's code block declares them.

## Files

- `CREATE: packages/model-openai-compat/src/types/config.ts` - `ProviderConfig`.
- `CREATE: packages/model-openai-compat/src/config.ts` - the schema and the three functions.
- `CREATE: packages/model-openai-compat/src/config.test.ts` - the cases below.
- `UPDATE: packages/model-openai-compat/src/index.ts:1-9` - export them.
- `UPDATE: packages/model-openai-compat/package.json` - `@cofold/sdk` as a dev dependency (`workspace:*`), for `validateSchema` in the test only.

## Steps

1. Tests first.
2. `providersOf` builds `openaiCompatProvider({ name: id, baseUrl, apiKey?, headers? })` per entry, keyed by `id`, in order.
3. `splitModel` splits at the first slash and returns `undefined` when it is first, last or missing.
4. `providerFor` throws `AgentError({ code: 'invalid_options' })`: `model "<ref>" must be written <provider>/<model>`; `no provider is configured`; `model "<ref>" names provider "<id>"; configured: a, b`.
5. `JsonSchema` and `AgentError` come from `@cofold/agents`; no new runtime dependency.

## Validation

- `splitModel('or/qwen/qwen3-8b')` is `{ provider: 'or', modelId: 'qwen/qwen3-8b' }`; `'qwen'`, `'or/'` and `'/m'` give `undefined`.
- `providerFor` on two providers finds `b/m`; `c/m` throws naming `a, b`; an empty map throws "no provider is configured"; `qwen` throws naming the shape.
- `providersOf` keeps the configuration's order and the provider's `id` is `openai-compat:<id>`.
- `validateSchema` from `@cofold/sdk` accepts papo's sample entries and refuses a missing `baseUrl` and an `id` with a slash.
- `pnpm --filter @cofold/model-openai-compat test` is clean.

## Resume

- **Built:** `types/config.ts` holds `ProviderConfig` with a doc comment per field; `config.ts` holds `PROVIDER_SCHEMA` (papo's, moved unchanged), `providersOf(configs)` (one `openaiCompatProvider({ name: id, baseUrl, apiKey?, headers? })` per entry, keyed by `id`, in order), `splitModel(ref)` returning `undefined` for a reference with no slash or nothing on either side, and `providerFor(providers, ref)` throwing `AgentError('invalid_options')` for a malformed reference, an empty map, or a name nothing answers to. `index.ts` exports the four and the type.
- **Circular import:** `config.ts` imports `openaiCompatProvider` from `./index.js`, which imports the schema and the functions back. ESM handles it because the only use is inside `providersOf`'s body; the alternative was moving `openaiCompatProvider` to a file of its own, which is more than this task asks.
- **Validation:** `config.test.ts` has six cases: the split at the first slash and the four `undefined` shapes; the order and the ids of `providersOf`; a provider named by the configured id rather than by its host (`localhost:1234` gives `openai-compat:lm`); `providerFor` finding `b/m` and `a/qwen/qwen3-8b`, refusing `c/m` with `configured: a, b`, an empty map with `no provider is configured`, and `qwen` with the shape message, both refusals being `AgentError` with code `invalid_options`; and `PROVIDER_SCHEMA` taking a bare and a full entry and refusing a missing `baseUrl`, a missing `id`, an id with a slash or a space, an empty id and an unknown key, with the issue `$.baseUrl shorter than 1`.
- **Departure:** the task file writes the dev dependency as `workspace:*`; it is `workspace:^`, which is how all six other packages declare `@cofold/sdk`. No new runtime dependency: `JsonSchema` comes from `@cofold/agents`, which re-exports it from the sdk as a type.
- **Checks:** `pnpm --filter @cofold/model-openai-compat exec vitest run --typecheck` 76 pass (was 70), five files, no type errors.

