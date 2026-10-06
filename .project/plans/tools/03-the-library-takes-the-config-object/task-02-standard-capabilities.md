---
title: standardCapabilities is in @cofold/tools
status: todo
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

