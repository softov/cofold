---
title: 107 - openai-compat streams over SSE with its own parser; streaming is on by default
status: accepted
date: 2026-09-16
refs:
  - code://packages/model-openai-compat/src/index.ts#L9 - `DEFAULT_FEATURES.streaming: false` before this decision
  - code://packages/model-openai-compat/src/wire.ts#L59-L97 - `fromWireResponse` and the `<think>` rule the stream keeps
  - https://platform.openai.com/docs/api-reference/chat/streaming - chunk shape, `stream_options.include_usage`, `data: [DONE]`
---

## Context

The adapter has zero dependencies (parent decision 6). Every Chat Completions server streams; LM Studio and OpenRouter report usage on the last chunk when asked.

## Decision

`@facio/model-openai-compat` implements `stream()` with its own SSE parser, sends `stream: true, stream_options: { include_usage: true }`, takes usage from the last chunk (zeros when absent) and splits a leading `<think>` block in streamed text into reasoning deltas as `fromWireResponse` does for a whole reply.
`DEFAULT_FEATURES.streaming` becomes `true`; `features: { streaming: false }` opts a model out.

Source: task outline (own parser); user, 2026-09-16, asked "Flip to true / Stay false"; `(defaulted: include_usage and the think split, the non-streaming behavior carried over)`.

## Consequences

papo streams by default once it reads `model.delta` (a `cli` plan). The catalogue keeps reporting the default feature set.
