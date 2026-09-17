---
title: 105 - ModelAdapter.stream yields text, reasoning and tool-call fragments, then done with the whole reply
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/model.ts#L55-L63 - `ModelAdapter`, where `stream?` is added
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-05-streaming.md - the task that builds it
---

## Context

The outline named four kinds: `text.delta`, `reasoning.delta`, `toolCall.delta`, `done`.
While writing, a session dropped `toolCall.delta` without asking; the user restored it.
This file exists so it is not dropped again.

## Decision

`ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `ModelStreamEvent = text.delta | reasoning.delta | toolCall.delta { index, callId?, name?, arguments } | done { reply }`.
The adapter assembles tool calls and `done.reply` carries them whole.
The loop ignores `toolCall.delta` and validates or executes nothing before `done`; the fragments exist for a host reading the adapter directly.

Source: task outline; user, 2026-09-16, asked "Keep toolCall.delta (outline) / Drop it".

## Consequences

Nothing partial can be executed.
A host that wants "calling X..." early reads the adapter's stream itself.

## Options

Three kinds (no `toolCall.delta`) made the loop simpler and took the early "calling X..." away from every host.
