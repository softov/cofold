---
title: Harness core - implemented
date: 2026-10-15
refs:
  - git://9500176 - the release of @cofold/agents 0.4.0, the newest version of the harness
  - "[code://packages/agents/src/index.ts](../../../../packages/agents/src/index.ts) - the harness exports"
  - "[code://examples/agents/standalone.ts](../../../../examples/agents/standalone.ts) - one agent run standalone"
---

`@cofold/agents` is the harness: contracts, a bounded loop, a run handle, durable approvals, resume, steering, streaming, compaction and usage accounting.
`@cofold/store-file` keeps sessions and runs on disk.
papo and ahpd both run agents on it.

## What was built

- p1 - the contracts, the validator, `createTool` and the memory store.
- p2 - the loop and the run handle.
- p3 - the file store, durable approvals, `resume()` and the writer fence.
- p5 - see [the p5 plan](../01-harness-core-p5-streaming-context-usage/plan.md).

## Verified

- On 2026-10-15, `pnpm check` passes at the repository root: 77 files and 1027 tests.
- ahpd's agent-cofold suite passes against `@cofold/agents` 0.4.0 at ahpd git://deaf702e.

## Departures from the plan

- p4, the ahpd adapter, was dropped. papo became the first consumer, and ahpd later wrote its own `agent-cofold` package.

## Left for later

- See [deferred.md](deferred.md).
