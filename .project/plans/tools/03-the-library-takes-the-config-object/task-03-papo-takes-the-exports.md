---
title: papo takes the exports
status: todo
depends: [task-01-the-providers-configuration.md, task-02-standard-capabilities.md]
layer: "papo"
refs:
  - "[code://packages/papo/src/config.ts#L12-L22](../../../../packages/papo/src/config.ts#L12-L22) - `PROVIDER`"
  - "[code://packages/papo/src/config.ts#L33-L109](../../../../packages/papo/src/config.ts#L33-L109) - `SCHEMA`, which composes the two"
  - "[code://packages/papo/src/config.ts#L220-L253](../../../../packages/papo/src/config.ts#L220-L253) - the three functions that go"
  - "[code://packages/papo/src/agent.ts#L41-L56](../../../../packages/papo/src/agent.ts#L41-L56) - `capabilitiesOf`, which goes"
  - "[code://packages/papo/src/chat.ts#L101](../../../../packages/papo/src/chat.ts#L101) - `providerFor` checks a picked model"
  - "[code://packages/papo/src/chat.ts#L128](../../../../packages/papo/src/chat.ts#L128) - `providerFor` for the turn"
  - "[code://packages/papo/src/chat.ts#L295](../../../../packages/papo/src/chat.ts#L295) - `splitModel(config.model).provider`"
  - "[code://packages/papo/src/screen/app.tsx#L405](../../../../packages/papo/src/screen/app.tsx#L405) - `splitModel(model).provider`"
  - "[code://packages/papo/src/screen/app.tsx#L420](../../../../packages/papo/src/screen/app.tsx#L420) - `splitModel(model).modelId`"
  - "[code://packages/papo/src/commands.ts#L141](../../../../packages/papo/src/commands.ts#L141) - `providersOf(config)` into `createChat`"
  - "[code://packages/papo/src/index.ts#L5](../../../../packages/papo/src/index.ts#L5) - papo exports `providersOf`, `providerFor`, `splitModel`"
  - "[code://packages/papo/src/types/config.ts](../../../../packages/papo/src/types/config.ts) - `ProviderConfig`, `SearchConfig`, `ToolsConfig`"
---

## Objective

papo validates its file with the library's schemas inside its own, builds providers and capabilities with the library's functions, and keeps only what is papo's: finding the file, its own keys, and its no-provider hint.

## Files

- `UPDATE: packages/papo/src/config.ts:12-22,76-104,220-253` - `providers: { type: 'array', items: PROVIDER_SCHEMA }`, `tools: TOOLS_SCHEMA`; the three functions go.
- `UPDATE: packages/papo/src/agent.ts:41-56,76` - `standardCapabilities(config.tools, { workspace: args.workspace, memoryDir: join(args.home, 'memory', workspaceSlug({ workspace: args.workspace })) })`, the folder papo uses today.
- `UPDATE: packages/papo/src/chat.ts:101,128,295` - `providers` is a `Map`; a local `providerOf(ref)` throws papo's hint when the map is empty and calls `providerFor` otherwise; `splitModel(...)?.provider`.
- `UPDATE: packages/papo/src/screen/app.tsx:405,420` - `splitModel(model)?.provider` and `?.modelId`.
- `UPDATE: packages/papo/src/commands.ts:141` - `providersOf(config.providers)`.
- `UPDATE: packages/papo/src/types/config.ts` - `ProviderConfig`, `SearchConfig`, `ToolsConfig` are the library's types.
- `UPDATE: packages/papo/src/index.ts:5` - drop the three exports.
- `UPDATE: packages/papo/src/config.test.ts:170-185` - the moved cases go; the papo cases (file layers, hint) stay.

## Steps

1. Switch the imports, then delete papo's copies.
2. Run papo's tests; a changed message is a regression unless it is the library's wording for the same case.

## Validation

- `config.test.ts` refusals (a bad provider, a bad tools key) still name the key.
- With no provider configured, papo's hint is the error.
- `pnpm --filter @cofold/papo test` and `pnpm typecheck` are clean.
- By hand: `papo` starts with the same `~/.config/papo/config.json`.

## Resume

