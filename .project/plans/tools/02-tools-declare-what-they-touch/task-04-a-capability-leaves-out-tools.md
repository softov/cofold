---
title: A capability leaves out the tools it is told to
status: todo
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/capability.ts#L18-L30](../../../../packages/agents/src/types/capability.ts#L18-L30) - `Capability`"
  - "[code://packages/agents/src/run/turn.ts#L93-L112](../../../../packages/agents/src/run/turn.ts#L93-L112) - `resolveCapabilities`: the duplicate check and `defer.over` by index"
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 84-91, `withoutTaken`, the filter this replaces
---

## Objective

`Capability.exclude?: readonly string[]` names tools of that capability to leave out, so a host's own tool of the same name takes the name; a duplicate nobody excluded still fails the run `invalid_options`.

## Files

- `UPDATE: packages/agents/src/types/capability.ts:18-30` - `exclude?`, with the doc comment from the plan.
- `UPDATE: packages/agents/src/run/turn.ts:97-110` - filter the contributed tools by `exclude` before the loop, so `defer.over` counts the tools that remain.
- `UPDATE: packages/agents/src/run/run.test.ts` - beside the duplicate case at line 269, the cases below.

## Steps

1. Tests first.
2. Filter in `resolveCapabilities`; an excluded name the capability does not contribute is ignored.

## Validation

- Agent tool `write_file` plus `{ ...cap, exclude: ['write_file'] }` contributing `write_file` and `read_file`: the run uses the agent's `write_file` and has `read_file`.
- The same without `exclude`: the run fails `invalid_options` naming the duplicate, as today.
- `defer: { over: 1 }` with the first tool excluded defers from the third contributed tool.
- `pnpm --filter @cofold/agents test` is clean.

## Resume

