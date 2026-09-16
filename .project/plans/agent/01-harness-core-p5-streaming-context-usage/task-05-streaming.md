---
title: Streaming
status: todo
depends: [task-04-provider-effort-levels-budgets-dynamic.md]
layer: agents
---

## Objective

Streaming.

## Files

- (see the plan)

## Steps

- `ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `text.delta`, `reasoning.delta`, `toolCall.delta`, `done { reply }`; the loop publishes `model.delta` for text immediately and assembles every tool call completely before validation or execution. A stream that ends before `done` records the step `failed`, never `uncertain` (spec: "A stream interruption must not leave a partial call that gets executed on retry"). `openaiCompat` implements SSE with its own parser (zero-deps rule). Open: whether `model.delta` is persisted (decision 61 says every event is; deltas are many and cheap) or coalesced into one event per step in the log.

## Validation

- (see the plan)

## Resume

(outline; `/dooplan` before `/dooit`)
