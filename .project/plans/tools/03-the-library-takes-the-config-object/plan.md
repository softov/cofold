---
title: The library takes the configuration object
domain: tools
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
decisions:
  - decisions/library-takes-the-config-object.md
refs:
  - "[code://packages/papo/src/config.ts#L12-L22](../../../../packages/papo/src/config.ts#L12-L22) - `PROVIDER`, the provider schema that moves"
  - "[code://packages/papo/src/config.ts#L76-L104](../../../../packages/papo/src/config.ts#L76-L104) - the `tools` schema that moves"
  - "[code://packages/papo/src/config.ts#L220-L253](../../../../packages/papo/src/config.ts#L220-L253) - `providersOf`, `splitModel` (throws), `providerFor`"
  - "[code://packages/papo/src/agent.ts#L41-L56](../../../../packages/papo/src/agent.ts#L41-L56) - papo's `capabilitiesOf`: fixed search order, memory under `home`"
  - "[code://packages/papo/src/types/config.ts](../../../../packages/papo/src/types/config.ts) - papo's `ProviderConfig`, `SearchConfig`, `ToolsConfig`"
  - "[code://packages/model-openai-compat/src/index.ts#L25](../../../../packages/model-openai-compat/src/index.ts#L25) - `openaiCompatProvider`, what a provider entry becomes"
  - "[code://packages/model-openai-compat/src/types/options.ts](../../../../packages/model-openai-compat/src/types/options.ts) - `OpenAICompatProviderOptions`: `baseUrl`, `apiKey`, `headers`, `name`"
  - "[code://packages/tools/src/index.ts](../../../../packages/tools/src/index.ts) - the capabilities and search providers `standardCapabilities` builds from"
  - "[code://packages/store-file/src/slug.ts#L4-L8](../../../../packages/store-file/src/slug.ts#L4-L8) - `workspaceSlug`, which papo and ahpd use to name their memory folders; `@cofold/tools` does not import it"
  - "[code://packages/config/src](../../../../packages/config/src) - `resolveConfig`: finds and layers a program's file, and has no providers concept"
  - file:///github/ahpd/packages/agent-cofold/src/config.ts - line 125, `splitModel` returns `undefined` on a bad reference; agent.ts lines 199 and 263 use that answer
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 30-118: `SearchConfig`, `ToolsConfig` (absent is on), `searchProviders` in key order, `capabilitiesOf` skipping memory without a store root
---

## Goal

A program that runs on cofold hands the providers list and the tools section it read to cofold, and gets back validated shapes, model providers, and the standard capabilities.
Where the file is stays each program's; papo and ahpd stop keeping two copies that already disagree.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg -n "splitModel|providerFor|providersOf|capabilitiesOf" packages/papo/src` - `config.ts`, `chat.ts:101,128,295`, `screen/app.tsx:405,420`, `commands.ts:141`, `agent.ts:42,76`.
- `rg -n "splitModel|capabilitiesOf|searchProviders" /github/ahpd/packages/agent-cofold/src` - `config.ts:125`, `agent.ts:199,263`, `capabilities.ts:64,102`.
- `rg -n "providers" packages/config/src` - nothing: `@cofold/config` knows no providers.
- `rg -n "code://packages/papo/src/config.ts" .project/` - cli/05 and agent/04 refs to older line numbers; nothing planned here.

### Runtime path

```
program finds and parses its file -> validates with PROVIDER_SCHEMA and TOOLS_SCHEMA inside its own schema
  -> providersOf(config.providers) -> providerFor(providers, ref) -> provider.model({ id, ... })
  -> standardCapabilities(config.tools, { workspace, memoryDir }) -> createAgent({ capabilities })
```

### Gaps

- Two `splitModel`s with two behaviours, two schemas, two ways from tools to capabilities.
- papo asks search providers in a fixed order, ahpd in the configuration's order.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [123 - The library takes the configuration object; each program finds its own file](../../../decisions/library-takes-the-config-object.md) | Softov, 2026-10-06, "Library takes the object" |

The choices below are tasks.

| What | Source | Task |
| --- | --- | --- |
| The providers part lives in `@cofold/model-openai-compat`: a provider entry is an OpenAI-compatible endpoint and becomes `openaiCompatProvider`; the package keeps its peer dependency on `@cofold/agents` only | (defaulted: `@cofold/config` has no providers concept and depends on `@cofold/commands`; `@cofold/agents` knows no endpoint; every configured provider is OpenAI-compatible, decision 112) | 01 |
| `ProviderConfig { id, baseUrl, apiKey?, headers? }`, `PROVIDER_SCHEMA` (papo's, unchanged), `providersOf(configs): Map<string, ModelProvider>` in configuration order | papo `config.ts:12-22,220-227` | 01 |
| `splitModel(ref)` returns `undefined` when the reference has no slash or nothing on one side; `providerFor(providers, ref)` throws `AgentError('invalid_options')` naming the expected shape, or that none is configured, or the configured ids | ahpd `config.ts:125` and its callers `agent.ts:199,263`, which need the "not a reference" answer; papo's throwing message lives on in `providerFor` | 01 |
| The tools part lives in `@cofold/tools`: `ToolsConfig`, `SearchConfig`, `TOOLS_SCHEMA` (papo's, unchanged), and `standardCapabilities(config, { workspace, memoryDir? })` | decision 123; Softov, 2026-10-06 (the brief) | 02 |
| An absent tools key is on; `false` turns one off; `web: { search }` adds `web_search` | ahpd `capabilities.ts:42-61`; papo's `BASE` sets all four on, so papo is unchanged | 02 |
| Search providers in the configuration's key order; capabilities always in the order files, shell, web, memory | ahpd `capabilities.ts:63-73`; Softov, 2026-10-06 (the brief: "search providers in configured order") | 02 |
| The caller passes the memory folder as `memoryDir`, and memory is skipped without it; `@cofold/tools` keeps its peer dependency on `@cofold/agents` alone | decision 123; Softov, 2026-10-06, asked "what should standardCapabilities take to place the memory tool's folder?": "memoryDir" | 02 |
| papo passes `join(home, 'memory', workspaceSlug({ workspace }))`, the folder it uses today | (defaulted: papo's memory stays where it is) | 03 |
| papo switches to the exports: its schema composes the two, its `providersOf`, `splitModel`, `providerFor` and `capabilitiesOf` go, its config types alias the library's, and `@cofold/papo` stops exporting the three functions | Softov, 2026-10-06 (the brief: "papo switches to the exports in the same plan") | 03 |
| papo keeps its own message for no provider at all ("set PAPO_BASE_URL or add one to ~/.config/papo/config.json"), checked before `providerFor` | (defaulted: the hint names papo's file, which the library must not know) | 03 |
| ahpd adopts after a cofold release, in an ahpd plan: `splitModel`, `searchProviders`, `capabilitiesOf` and the two config interfaces go; ahpd passes `memoryDir: join(storeRoot, 'memory', workspaceSlug({ workspace }))` itself, and none without a store root; `harnessConfigPath` and its reader stay | decision 123 | 04 |

## Proposed architecture

- **Data flow** - the program's parsed object goes in; providers and capabilities come out; nothing is read from disk by the library.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - model-openai-compat: the providers shape and its functions · tools: the tools shape and `standardCapabilities` · papo: finds its file and composes the schemas.
- **Source-of-truth files** - `packages/model-openai-compat/src/config.ts`, `packages/tools/src/standard.ts` (both created by this plan)

```ts
// @cofold/model-openai-compat
export interface ProviderConfig { id: string; baseUrl: string; apiKey?: string; headers?: Record<string, string> }
export const PROVIDER_SCHEMA: JsonSchema;
export function providersOf(configs: readonly ProviderConfig[]): Map<string, ModelProvider>;
export function splitModel(ref: string): { provider: string; modelId: string } | undefined;
export function providerFor(providers: ReadonlyMap<string, ModelProvider>, ref: string): { provider: ModelProvider; modelId: string };

// @cofold/tools
export interface SearchConfig { brave?: { apiKey: string }; tavily?: { apiKey: string }; duckduckgo?: boolean }
export interface ToolsConfig { files?: boolean; shell?: boolean; web?: boolean | { search?: SearchConfig }; memory?: boolean }
export const TOOLS_SCHEMA: JsonSchema;
export function standardCapabilities(config: ToolsConfig, args: { workspace: string; memoryDir?: string }): Capability[];
```

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The providers configuration in model-openai-compat](task-01-the-providers-configuration.md) | done | - |
| [02 - standardCapabilities in @cofold/tools](task-02-standard-capabilities.md) | done | - |
| [03 - papo takes the exports](task-03-papo-takes-the-exports.md) | done | 01, 02 |
| [04 - The READMEs, and ahpd's adoption](task-04-readmes-and-ahpd.md) | done | 01, 02 |

## Risks and tradeoffs

- The plan spans three packages, which do-spec would make a parent; it stays one plan because Softov asked for four plans, and each task stays inside one package.
- papo's search order becomes the configuration's key order; a papo file that lists `duckduckgo` before `brave` now asks DuckDuckGo first.
- `providersOf` returns a `Map` where papo passed an array, so papo's `createChat` changes its `providers` type.
- Each program spells its memory folder itself; papo and ahpd use the same `<root>/memory/<workspaceSlug>` form, so the two stay alike by convention, not by code.

## Resume state

- **Done so far:** every task, 01 to 04. The four are `implemented` in this table and in their own files, and [implemented.md](implemented.md) records what was built, what was verified and where the work departed from this plan. Task 04's ahpd half is [deferred.md](deferred.md)'s only row.
- **Next action:** none - the plan is built. Softov's review is what moves a task from `implemented` to `done`.
- **Open questions:** none.
- **Watch out for:** tools/02 also edits `packages/tools/src/index.ts` and `packages/papo/src/agent.ts`; keep both changes. `exactOptionalPropertyTypes` in the provider options spread. `args.workspace` of `standardCapabilities` is declared and unread, left as the plan asks.

## Final verification checklist

- [x] papo starts with the same file it reads today, and refuses the same bad files with the same messages - the file-layer, merge and refusal cases of `packages/papo/src/config.test.ts` and the `providers` and `models` command cases; the by-hand start is not run (no terminal or endpoint here), see [implemented.md](implemented.md).
- [x] `splitModel('or/qwen/qwen3-8b')` is `{ provider: 'or', modelId: 'qwen/qwen3-8b' }`; `splitModel('qwen')` is `undefined` (`packages/model-openai-compat/src/config.test.ts`).
- [x] `standardCapabilities({ web: { search: { duckduckgo: true, brave: { apiKey: 'k' } } } }, { workspace })` asks DuckDuckGo first and has no memory (`packages/tools/src/standard.test.ts`).
- [x] `pnpm check` in cofold is clean - `pnpm typecheck` clean and `pnpm test` 937 of 937, after `@cofold/store-file`'s copied-folder test was fixed (Softov's answer, recorded in agent/05's [implemented.md](../agent/05-a-run-answers-its-own-pause/implemented.md)).
- [x] `plans/index.md` updated.
