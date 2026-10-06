---
title: The library takes the configuration object - deferred
date: 2026-10-06
---

One thing waits: ahpd's work, in another repository.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd adopts the configuration exports - `packages/agent-cofold/src/config.ts`'s `ProviderConfig`, `SearchConfig` and `ToolsConfig` at lines 21-43 and its `splitModel` at 116-129 go, `agent.ts` lines 199 and 263 call the library's instead, and `capabilities.ts`'s `SearchConfig`, `ToolsConfig`, `searchProviders` and `capabilitiesOf` at lines 30-118 become `standardCapabilities` with `Capability.exclude` where it leaves a tool out. `harnessConfigPath` and its reader stay, and ahpd passes `memoryDir: join(storeRoot, 'memory', workspaceSlug({ workspace }))` itself, and no `memoryDir` when its store is in memory (task 04) | it is ahpd work, and it needs a cofold release carrying this plan; cofold changes nothing here. `splitModel` returning `undefined` on a bad reference is the answer ahpd's two call sites need, and papo's throwing message lives on in `providerFor` | an ahpd plan, opened after that release, naming this task and the cofold versions it needs |
