---
title: 123 - The library takes the configuration object; each program finds its own file
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/papo/src/config.ts#L12-L22](../../packages/papo/src/config.ts#L12-L22) - papo's provider schema"
  - "[code://packages/papo/src/config.ts#L76-L104](../../packages/papo/src/config.ts#L76-L104) - papo's tools schema"
  - "[code://packages/papo/src/config.ts#L220-L253](../../packages/papo/src/config.ts#L220-L253) - `providersOf`, `splitModel`, `providerFor`"
  - "[code://packages/papo/src/agent.ts#L42-L56](../../packages/papo/src/agent.ts#L42-L56) - papo's `capabilitiesOf`"
  - file:///github/ahpd/packages/agent-cofold/src/config.ts - ahpd reads `$COFOLD_CONFIG` or `~/.config/cofold/config.json`, and its own `splitModel`
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - ahpd's `capabilitiesOf`, `searchProviders` and `toolsOf`
---

## Context

papo and ahpd each read a providers list and a tools section and turn them into model providers and `@cofold/tools` capabilities.
Each has its own schema, its own `splitModel`, and its own way from a tools section to capabilities, and the two already differ: papo's `splitModel` throws on a bad reference and ahpd's returns nothing, and papo asks the search providers in a fixed order where ahpd keeps the configuration's order.
The files themselves differ on purpose: papo reads `~/.config/papo/config.json` through `@cofold/config` layers, and ahpd reads the file `$COFOLD_CONFIG` names.

## Decision

cofold exports the shape of the providers and tools configuration, the schemas that validate it, `splitModel`, `providerFor`, and `standardCapabilities(config, { workspace, memoryDir? })`.
A program passes the object it read; where the file is, and how it is found, stays each program's, and nothing moves on disk.
The caller passes the memory tool's folder as `memoryDir`, and memory is left out when it is absent; `@cofold/tools` takes no dependency on `@cofold/store-file`, and each program decides where memory lives.

Source: Softov, 2026-10-06, asked "Plan D: where does the provider, model and tools config come from?": "Library takes the object".
Source for `memoryDir`: Softov, 2026-10-06, asked "what should standardCapabilities take to place the memory tool's folder?": "memoryDir".

## Consequences

papo and ahpd build providers and capabilities through the same functions, so the two cannot drift again.
A program still writes its own file reader, and still owns the keys of its file that are not providers or tools.
ahpd adopts the exports after a cofold release.

## Options

One shared cofold file, where `@cofold/*` itself also reads `~/.config/cofold/config.json`, was rejected: finding a file is each program's, and a library that reads a fixed path takes that choice away.
`storeRoot`, from which `@cofold/tools` would compute `<storeRoot>/memory/<workspaceSlug>`, was rejected: it needs a peer dependency on `@cofold/store-file` and fixes where every program keeps memory.
papo's file as the standard was rejected: papo's file carries papo's own keys (theme, shell, backend), and another program would inherit them.
