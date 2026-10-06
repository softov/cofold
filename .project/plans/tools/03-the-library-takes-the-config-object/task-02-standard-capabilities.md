---
title: standardCapabilities is in @cofold/tools
status: done
depends: []
layer: "tools"
refs:
  - "[code://packages/papo/src/config.ts#L76-L104](../../../../packages/papo/src/config.ts#L76-L104) - the tools schema, moved as `TOOLS_SCHEMA`"
  - "[code://packages/papo/src/agent.ts#L41-L56](../../../../packages/papo/src/agent.ts#L41-L56) - papo's `capabilitiesOf`"
  - "[code://packages/tools/src/index.ts](../../../../packages/tools/src/index.ts) - the exports"
  - "[code://packages/tools/package.json](../../../../packages/tools/package.json) - peer dependency `@cofold/agents` only, today"
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 30-118, the semantics to keep: absent is on, key order, memory only when a folder is given
---

## Objective

`@cofold/tools` exports `SearchConfig`, `ToolsConfig`, `TOOLS_SCHEMA` and `standardCapabilities(config, { workspace, memoryDir? })`, which builds files, shell, web and memory as the plan's table says.

## Files

- `CREATE: packages/tools/src/types/standard.ts` - `SearchConfig`, `ToolsConfig`, each key with a doc comment (ahpd's wording).
- `CREATE: packages/tools/src/standard.ts` - `TOOLS_SCHEMA` and `standardCapabilities`.
- `CREATE: packages/tools/src/standard.test.ts` - the cases below.
- `UPDATE: packages/tools/src/index.ts` - export them.
- `UPDATE: packages/tools/package.json` - `@cofold/sdk` as a dev dependency for the schema test only; no new peer dependency (decision 123).

## Steps

1. Tests first.
2. Search providers: walk `Object.keys(search)`; `brave` and `tavily` with a key, `duckduckgo` when `true`.
3. Memory: `memory({ dir: memoryDir })` only when `config.memory !== false` and `memoryDir` is given.

## Validation

- `{}` with a `memoryDir` gives four capabilities in the order files, shell, web, memory; without one, three.
- `{ shell: false, web: false }` gives files and memory.
- `{ web: { search: { duckduckgo: true, brave: { apiKey: 'k' } } } }`: `web_search` asks DuckDuckGo first.
- `{ web: true }`: `web_fetch` and no `web_search`.
- The memory capability's folder is the `memoryDir` given, as is.
- `TOOLS_SCHEMA` refuses `{ web: { search: { brave: {} } } }`.
- `pnpm --filter @cofold/tools test` is clean.

## Resume

- **Built:** `types/standard.ts` holds `SearchConfig` and `ToolsConfig`, a key left out being on; `standard.ts` holds `TOOLS_SCHEMA` (papo's tools block, moved unchanged) and `standardCapabilities(config, { workspace, memoryDir? })`, which answers files, shell, web and memory in that order, leaves memory out without a `memoryDir`, and builds the search providers by walking `Object.keys(config.web.search)`, so the file's own key order is the order they are asked. `index.ts` exports the two types, `TOOLS_SCHEMA` and `standardCapabilities`; `package.json` gains `@cofold/sdk` as a dev dependency, and the peer dependency is still `@cofold/agents` alone.
- **Validation:** `standard.test.ts` has seven cases: the four capabilities and their order with a `memoryDir`, three without one (with `memory` absent and with it `true`); `{ shell: false, web: false }` giving files and memory; the search order off the `web_search` description (`(duckduckgo, then brave)`, then `(tavily, then duckduckgo)` for the other key order) and no `web_search` at all for `{ duckduckgo: false }`; `{ web: true }` giving `web_fetch` alone while files keeps its five tools and shell its one; the memory folder being the `memoryDir` as given, read off `memory_write`'s `writes` and its relative `subject`; and `TOOLS_SCHEMA` taking the shapes a file writes and refusing a `brave` with no key, an empty key, an unknown backend, a wrong type on a key and an unknown key, the refusal being `[{ path: '$.web', message: 'matches none of anyOf' }]`.
- **Observation:** the plan's signature carries `args.workspace` and nothing reads it: the file and shell capabilities take the workspace per run from `CapabilityArgs`. It is left as the plan declares, with the doc comment saying where the workspace really comes from, and it is named here for review.
- **Departure:** none. The search order is read off the tool description, because `standardCapabilities` gives no way to inject a fetch and so no provider can be exercised without reaching the network.
- **Checks:** `pnpm --filter @cofold/tools exec vitest run --typecheck` 40 pass in six files (was 33 in five), no type errors; `pnpm --filter @cofold/tools typecheck` clean.
