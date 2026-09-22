---
title: A provider that cannot be reached does not hide the others; the shell lists providers and one provider's models
status: done
depends: []
layer: papo
refs:
  - code://packages/papo/src/chat.ts#L263-L275 - `models()`: one loop over every provider; the first `listModels` that throws rejects the whole call
  - code://packages/papo/src/claude/chat.ts#L340-L349 - the Claude backend's `models()`: one provider, `claude`
  - code://packages/papo/src/types/chat.ts#L112 - `Chat.models(): Promise<ModelRow[]>`
  - code://packages/papo/src/commands.ts#L462-L473 - the `models` action: everything, one table
  - code://packages/papo/src/screen/app.tsx#L676-L678 - the screen lists every provider once at start, in the background; an unreachable one fails the whole list
  - code://packages/papo/src/config.ts#L179-L192 - `providerFor`: the "names provider X; configured: ..." message to reuse for an unknown provider id
---

## Objective

With two providers configured and one of them down, the screen and the shell still offer the other's models (user, 2026-09-16: "with the config always choose local ai, that is not running... I cannot make it use openrouter, only removing the other"); `papo providers` lists what is configured and `papo models <provider>` lists one provider's models.

## Files

- `UPDATE: packages/papo/src/types/chat.ts:112` - `models(args?: { provider?: string }): Promise<ModelRow[]>`.
- `UPDATE: packages/papo/src/chat.ts:263-275` - per provider; one named provider throws, the whole list warns and skips.
- `UPDATE: packages/papo/src/claude/chat.ts:340-349` - `provider` other than `claude` is `invalid_options`.
- `UPDATE: packages/papo/src/commands.ts:462-473` - `models [provider]`; new `providers` action.
- `UPDATE: packages/papo/src/chat.test.ts`, `commands.test.ts`, `claude/chat.test.ts` - the cases below.
- `UPDATE: packages/papo/README.md` - the two shell lines.
- The screen's on-demand listing per provider is task 02's (its `model` argument calls `chat.models({ provider })`); the start-up preload at `app.tsx:676` goes with it.

## Steps

1. `chat.ts` `models({ provider } = {})`: `provider` given -> the one configured provider of that id (unknown id -> `AgentError invalid_options`: `provider "x" is not configured; configured: a, b`), its `listModels` error propagates (the caller asked about this one and must see why). No `provider` -> every provider in order; a provider whose `listModels` throws is skipped and `warn`ed once (`provider "local_provider": <message>`); no provider configured -> `invalid_options` as today. Rows keep `{ ...model, provider: id, ref }`.
2. Claude backend: `models({ provider })` with a provider that is not `claude` -> `invalid_options`; otherwise as today.
3. Shell: `models` gains an optional positional `provider` (`pattern: ['models', ':provider?']` or the framework's optional-positional form; check `packages/commands` for how an optional positional is declared and reuse it); `providers` (group `setup`) prints a table `provider | base url | key` (`yes`/`no`, never the key itself) and marks the first with `(first listed)` when `config.model` is absent, or the one `config.model` names with `(default)`. The Claude backend lists `claude`.
4. Tests: `chat.test.ts`: a `testChat` with two fake providers, the second's `listModels` rejecting: `models()` returns the first's rows and warns once; `models({ provider: second })` rejects with the provider's error; `models({ provider: 'nope' })` rejects `invalid_options`. `commands.test.ts`: `papo providers` table; `papo models fake` lists one provider. `claude/chat.test.ts`: `models({ provider: 'other' })` rejects.

## Validation

- `pnpm vitest run --project @cofold/papo`; `pnpm check`.
- By hand: the user's configuration with `local_provider` down: the chip lists `open_router`'s models; `papo models local_provider` says why it cannot; `papo providers` lists both.

## Resume

Done 2026-09-16.
`Chat.models({ provider? })` (`types/chat.ts`): every provider in order, one that throws is `warn`ed as `provider "<id>": <message>` and skipped; named, its error propagates; an unknown id is `invalid_options` naming the configured ids (`chat.ts`; the Claude backend accepts `claude` only).
`Chat.providers()` and `ProviderRow { id, baseUrl?, key, default }` (new, beyond the task's Files): the configuration's list with `default` per cli/01 decision 11, or `claude` on that backend; what the shell's `providers` action and the chip's first question read, so neither derives the providers from model rows nor reads the configuration in the front.
Shell: `providers` (table `provider | base url | key | first listed / default`, the key never printed) and `models [provider]` (`':provider?'`), both `mcp: true`.
Screen (`screen/app.tsx`, `state.ts`): `PROVIDERS` is read once at start from `chat.providers()` (no network); `MODELS` is `Record<provider, ModelRow[]>` filled by `modelsOf(provider)` when a provider is chosen, once; the start-up preload of every provider is gone, so a provider that is down costs nothing until chosen and then says why on the status row (`models: <id>: <message>`) with nothing to choose.
`testChat` takes `providers` (more providers after `fake`) and `warn`.
Tests: `chat.test.ts` "lists the providers that answer when another cannot be reached..." (the whole list, the warning, the one named, the unknown id); `commands.test.ts` "lists the providers and the models of each..." (`providers --json`, the table, `models`, `models fake`, `models local` failing with the provider's error, `models nope`); `screen.test.ts` "a provider that is down is still offered, says why when chosen, and does not hide the other one".
Deviation: the chip's provider question reads `chat.providers()` rather than the listed models' `provider` fields (task 02's choice, made when every provider was preloaded); with the listing on demand there are no rows to derive from before a pick.
