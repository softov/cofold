---
title: `load_tools` and the session memory of it
status: done
depends: [task-01-field-capability-option-definition-split.md]
layer: agents
---

## Objective

`load_tools` and the session memory of it.

## Files

- (see the plan)

## Steps

- The tool; the kv key; the rebuild after a load; `createTurnContext` reading the key; decision 6.

## Validation

- script: model calls `load_tools({ names: ['deferred_echo'] })` → next request carries its definition and the `## tools` section no longer names it; then calls `deferred_echo` → executes; a second `run()` on the same session starts with it in the first request; `resume()` after a pause on a loaded tool's approval keeps it; `query` matching; unknown name reported; a valid call to an unloaded deferred tool executes and loads it.

## Resume

Done; see the plan's Resume state.
