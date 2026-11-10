---
title: The adapter sends the app's name
status: implemented
depends: []
layer: "model-openai-compat"
refs:
  - "[code://packages/model-openai-compat/src/index.ts#L27-L37](../../../../packages/model-openai-compat/src/index.ts#L27-L37) - `baseHeaders`, where the app's headers start"
  - "[code://packages/model-openai-compat/src/config.ts#L19-L30](../../../../packages/model-openai-compat/src/config.ts#L19-L30) - `providersOf`, which passes the app on"
---

## Objective

Every request of `openaiCompatProvider` sends `User-Agent: <name>/<version>`, and a request to OpenRouter also sends `HTTP-Referer` and `X-OpenRouter-Title`.

## Files

- `UPDATE: packages/model-openai-compat/src/types/options.ts:3-17` - `app?: AppIdentity` on `OpenAICompatProviderOptions`, and the `AppIdentity` type.
- `CREATE: packages/model-openai-compat/src/app.ts` - `VERSION`, `DEFAULT_APP` and `appHeaders(app, baseUrl)`.
- `UPDATE: packages/model-openai-compat/src/index.ts:31` - `baseHeaders` starts with `appHeaders`; the provider's `headers` replace a header of the same name in any case.
- `UPDATE: packages/model-openai-compat/src/config.ts:19-30` - `providersOf(configs, options?: { app?: AppIdentity })`.
- `UPDATE: packages/model-openai-compat/src/index.ts` - export `AppIdentity`, `DEFAULT_APP` and `VERSION`.
- `CREATE: packages/model-openai-compat/src/app.test.ts` - the headers per host, the default, the override, `VERSION` against `package.json`.
- `UPDATE: packages/model-openai-compat/src/index.test.ts:57-104` - the whole-header expectations gain `user-agent`.
- `UPDATE: packages/model-openai-compat/README.md` - the `app` option and the headers it sends.

## Steps

1. Add `AppIdentity` as `{ name: string; version: string; url: string }` in `types/options.ts`.
2. Write `appHeaders` to return `user-agent` always, and `http-referer` with `x-openrouter-title` on an OpenRouter host.
3. Test the host as `openrouter.ai` or a name that ends with `.openrouter.ai`.
4. Build `baseHeaders` from `content-type`, then `appHeaders`, then the provider's `headers`.
5. Drop an app header when the provider's `headers` hold the same name in another case.
6. Give `providersOf` an optional `{ app }` and pass it to each provider.
7. Document `app` in the README options table.

## Validation

- `app.test.ts`: the default app on a local URL gives only `user-agent: cofold/<VERSION>`.
- `app.test.ts`: `https://openrouter.ai/api/v1` gives all three headers with the app's name and URL.
- `app.test.ts`: a provider `User-Agent` header wins over the app's.
- `app.test.ts`: `VERSION` equals the version in `package.json`.
- `pnpm --filter @cofold/model-openai-compat test` is green.

## Resume
Implemented 2026-11-10. `app.ts` holds `VERSION`, `DEFAULT_APP`, `appHeaders` and `mergeHeaders`.
`app.test.ts` has 5 tests, and the adapter's 6 test files and 81 tests pass.
