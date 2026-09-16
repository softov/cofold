---
title: 106 - A stream that ends before done fails the step; nothing is retried once the body is being read
status: accepted
date: 2026-09-16
refs:
  - code://.project/specs/agent-harness-spec.md#L78 - "A stream interruption must not leave a partial call that gets executed on retry"
  - code://packages/model-openai-compat/src/index.ts#L28-L67 - `send()`'s retry loop (decision 32)
---

## Context

An interrupted stream has published text and may hold half a tool call. Retrying mid-body would re-emit what was published; leaving the step `uncertain` would suggest something ran.

## Decision

A stream that ends without `done` throws `ModelError { code: 'invalid_response' }`: the step is `failed` (never `uncertain`), the run `failed`, no assistant message is written.
An adapter retries only before the response body starts (decision 32's statuses); once bytes are being read nothing is retried.

Source: spec; `(defaulted: the retry boundary)` by the planner, 2026-09-16.

## Consequences

The spec's "partial streamed call" test is `run/stream.test.ts` case 4.
