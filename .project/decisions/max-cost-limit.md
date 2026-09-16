---
title: 110 - limits.maxCost stops a run at a dollar ceiling
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/limits.ts - `Limits`, where `maxCost` goes
  - code://packages/agents/src/run/turn.ts#L154-L157 - the loop-top checks (`abort`, steer drain, `maxSteps`)
  - code://.project/specs/agent-harness-spec.md#L100 - "Time, model-call, tool-call, output-size, and cost limits should be enforced by the runtime"
---

## Context

The spec asks for a cost limit enforced by the runtime; the loop already refuses a step at `maxSteps`.

## Decision

`limits.maxCost` (USD, `0` = none, default `0`), checked at the loop top after `maxSteps`: the step that crosses it completes, the next never starts; outcome `stopped { reason: 'max_cost' }`. `StopReason` gains `'max_cost'`. Without pricing the check never trips.

Source: task outline; `(defaulted: checked where maxSteps is, the only place a step is refused)`.

## Consequences

A budget is a hard stop, not a hint in the instructions. Consumers reading `stopped` gain one more `reason`.
