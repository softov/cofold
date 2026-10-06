---
title: The library takes the configuration object - implemented
date: 2026-10-06
refs:
  - git://1d505a4 - the last commit before this plan's work; everything below is uncommitted on top of it
  - "[code://packages/model-openai-compat/src/config.ts](../../../../packages/model-openai-compat/src/config.ts) - `PROVIDER_SCHEMA`, `providersOf`, `splitModel`, `providerFor`"
  - "[code://packages/model-openai-compat/src/types/config.ts](../../../../packages/model-openai-compat/src/types/config.ts) - `ProviderConfig`"
  - "[code://packages/tools/src/standard.ts](../../../../packages/tools/src/standard.ts) - `TOOLS_SCHEMA` and `standardCapabilities`"
  - "[code://packages/tools/src/types/standard.ts](../../../../packages/tools/src/types/standard.ts) - `SearchConfig`, `ToolsConfig`"
  - "[code://packages/papo/src/config.ts](../../../../packages/papo/src/config.ts) - the schema that composes the two libraries'"
  - "[code://packages/papo/src/chat.ts](../../../../packages/papo/src/chat.ts) - `ChatOptions.providers`, now a `Map`"
  - "[code://packages/papo/src/testing.ts](../../../../packages/papo/src/testing.ts) - `providerMap`, what a test hands a chat"
---

A program hands the providers list and the tools section it read to cofold, and gets back the validated shapes, the model providers and the standard capabilities.
Where the file is stays the program's; papo keeps only finding it, its own keys and its no-provider hint, and its four copies are gone.

## What was built

- [`code://packages/model-openai-compat/src/types/config.ts`](../../../../packages/model-openai-compat/src/types/config.ts), [`code://packages/model-openai-compat/src/config.ts`](../../../../packages/model-openai-compat/src/config.ts) - `ProviderConfig { id, baseUrl, apiKey?, headers? }`; `PROVIDER_SCHEMA` (papo's, unchanged); `providersOf(configs)` answering a `Map<string, ModelProvider>` in the configuration's order, one `openaiCompatProvider({ name: id, ... })` per entry; `splitModel(ref)` splitting at the first slash so a model id keeps its own slashes and answering `undefined` when there is no slash or nothing on one side; `providerFor(providers, ref)` throwing `AgentError('invalid_options')` for a malformed reference, an empty map, or an id nothing answers to. All four are exported from the package's entry.
- [`code://packages/tools/src/types/standard.ts`](../../../../packages/tools/src/types/standard.ts), [`code://packages/tools/src/standard.ts`](../../../../packages/tools/src/standard.ts) - `SearchConfig` and `ToolsConfig` (a key left out is on); `TOOLS_SCHEMA` (papo's tools block, unchanged); `standardCapabilities(config, { workspace, memoryDir? })` answering files, shell, web and memory in that order, leaving memory out without a `memoryDir`, and building the search providers by walking the section's own key order.
- [`code://packages/papo/src/config.ts`](../../../../packages/papo/src/config.ts) - `SCHEMA` composes the two libraries' schemas (`providers: { type: 'array', items: PROVIDER_SCHEMA }`, `tools: TOOLS_SCHEMA`) and papo's `PROVIDER`, its tools block and its `providersOf`, `splitModel`, `providerFor` are deleted. [`code://packages/papo/src/types/config.ts`](../../../../packages/papo/src/types/config.ts) re-exports the library's `ProviderConfig`, `SearchConfig` and `ToolsConfig` as types, so there is still one definition of each; `index.ts` drops the three functions.
- [`code://packages/papo/src/agent.ts`](../../../../packages/papo/src/agent.ts) - `capabilitiesOf` is gone; `buildAgent` passes `standardCapabilities(config.tools, { workspace, memoryDir: join(home, 'memory', workspaceSlug({ workspace })) })`, the folder papo uses today, beside `skills(...)`.
- [`code://packages/papo/src/chat.ts`](../../../../packages/papo/src/chat.ts) - `ChatOptions.providers` is a `ReadonlyMap<string, ModelProvider>`; a local `providerOf(ref)` throws papo's own hint ("set PAPO_BASE_URL or add one to ~/.config/papo/config.json") when the map is empty and calls `providerFor` otherwise, so the library's message names the shape and papo's names its file. `modelRef()` takes the first configuration entry's provider from the map, `providers()` reads `splitModel(config.model)?.provider`, and `models()` walks the map. `commands.ts` builds it with `providersOf(config.providers)`; `screen/app.tsx` imports `splitModel` from the library.
- [`code://packages/papo/src/testing.ts`](../../../../packages/papo/src/testing.ts) - `providerMap(config, models)`, one model per configured provider in the configuration's order keyed by the id its entry writes, is what `testChat` and the tests that build a chat by hand now use.
- [`code://packages/model-openai-compat/README.md`](../../../../packages/model-openai-compat/README.md), [`code://packages/tools/README.md`](../../../../packages/tools/README.md) - a *Configuration* section with one example (the program parses its own file, validates against the schema, builds the map, picks a provider) and a table of what each export does; a *standardCapabilities* section with the four keys, the `web: { search }` shape, and the sentence that the file, its environment variables and the memory folder are the program's to choose.

## Verified

- `pnpm typecheck` on 2026-10-06: clean in every package and example, no type errors.
- `pnpm test` on 2026-10-06, when the plan was built: 937 tests across 74 files, 936 passed, one failed - `@cofold/store-file`'s "a session folder copied to another root resumes there", the fork this project carried since agent/05 and untouched by this plan. Type errors: none.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after that test was fixed (Softov's answer, recorded in agent/05's [implemented.md](../agent/05-a-run-answers-its-own-pause/implemented.md)): clean, 937 tests across 74 files, all passed, no type errors. So the checklist's "`pnpm check` in cofold is clean" now holds.
- `pnpm typecheck` and `pnpm test` on 2026-10-06, after the review fixes recorded in agent/05's and tools/02's implemented.md: clean, 945 tests across 75 files, all passed, no type errors.
- `@cofold/model-openai-compat` - 76 tests in five files (was 70). `config.test.ts` covers the split at the first slash and the four `undefined` shapes; `providersOf`'s order and ids (a provider is named by its configured `id`, not by its host); `providerFor` finding `b/m` and `a/qwen/qwen3-8b`, refusing `c/m` with `configured: a, b`, an empty map with `no provider is configured`, and `qwen` with the shape message, all three refusals `AgentError` with code `invalid_options`; and `PROVIDER_SCHEMA` taking a bare and a full entry and refusing a missing or empty `id`, an id with a slash or a space, a missing `baseUrl` and an unknown key.
- `@cofold/tools` - 40 tests in six files (was 33 in five). `standard.test.ts` covers the four capabilities and their order with a `memoryDir` and three without one; `{ shell: false, web: false }` giving files and memory; the search order read off `web_search`'s description (`(duckduckgo, then brave)`, and `(tavily, then duckduckgo)` for the other key order) and no `web_search` at all for `{ duckduckgo: false }`; `{ web: true }` giving `web_fetch` alone while files keeps its five tools and shell its one; the memory folder as given, read off `memory_write`'s `writes` and its relative `subject`; and `TOOLS_SCHEMA` refusing a `brave` with no key, an empty key, an unknown backend, a wrong type and an unknown key with `[{ path: '$.web', message: 'matches none of anyOf' }]`.
- `@cofold/papo` - 140 tests in eight files. The refusals still name the key (`config.providers.id must be`, `config.tools.web`), the file layers and merges are unchanged, and a case added to `chat.test.ts` proves papo's hint is the error with no provider at all, through both `say` and `models` - what the deleted `providerFor([], ...)` case used to cover.
- The README examples were typechecked by writing each one into a temporary `readme-check.ts` in the package's `src` and running the package's typecheck; both were clean and the files were removed.
- **Not run, by hand:** "`papo` starts with the same `~/.config/papo/config.json`". There is no terminal and no reachable endpoint here; the file-layer, merge and refusal cases of `config.test.ts` and the `providers` and `models` command cases stand in for it.

## Departures from the plan

- Task 01 - the dev dependency is `workspace:^` rather than the task's `workspace:*`, which is how the six other packages declare `@cofold/sdk`. `JsonSchema` comes from `@cofold/agents`, which re-exports it from the sdk as a type, so there is still no new runtime dependency.
- Task 02 - the task's signature carries `args.workspace` and nothing reads it: the file and shell capabilities take the workspace per run from `CapabilityArgs`. It is left as the plan declares, with the doc comment saying where the workspace really comes from, and named here for review rather than changed.
- Task 04 - the ahpd half is not built and cannot be here: it is another repository's work and waits for a cofold release, which this build does not make. It is in [deferred.md](deferred.md).
- The plan's *Final verification checklist* asks for a by-hand papo start, which is not run (above); the other four items hold, the `pnpm check` one since the store-file test was fixed.

## Left for later

- ahpd's adoption, in [deferred.md](deferred.md).
