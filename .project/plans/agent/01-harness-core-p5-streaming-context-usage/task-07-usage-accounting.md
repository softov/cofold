---
title: Usage accounting
status: todo
depends: [task-06-context-reduction-compact.md]
layer: agents
---

## Objective

Usage accounting.

## Files

- (see the plan)

## Steps

- `Usage` accumulated per run in `RunRecord.usage` (exists since p2); add `limits.maxCost` with `ModelAdapter.pricing?: { inputPerMillion; outputPerMillion }` → `stopped { reason: 'max_cost' }`. Open: whether pricing lives on the adapter or on `AgentOptions` (the catalogue, decision 44, is where the provider reports it; the adapter is the natural carrier).

## Validation

- (see the plan)

## Resume

(outline)
