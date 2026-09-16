---
title: the field, the capability option, the definition split
status: done
depends: []
layer: agents
---

## Objective

the field, the capability option, the definition split.

## Files

- (see the plan)

## Steps

- `deferred` on tools; `defer` on capabilities; `requestToolsOf`; `## tools` section; `AgentDefinition.deferred`.

## Validation

- a run with one deferred tool sends one definition fewer and one index line more (`model.requests[0].tools`, `instructions`); `defer: { over: 1 }` on a two-tool capability defers the second.

## Resume

Done; see the plan's Resume state.
