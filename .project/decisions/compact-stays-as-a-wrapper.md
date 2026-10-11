---
title: AGENT-03.4 - compact() stays exported and runs /compact
status: accepted
date: 2026-10-11
refs:
  - "[code://packages/agents/src/run/compact.ts#L24](../../packages/agents/src/run/compact.ts#L24) - `compact()`, published in `@cofold/agents` 0.2.1"
---

## Context

`/compact` becomes a built-in runtime command.
`compact()` is a published export that does the same thing through a second path.

## Decision

`compact(args)` stays and calls `run()` with the input `/compact`.
It has one path through the harness, the command run.
Source: Softov, 2026-10-11, asked "The published compact() export (agents 0.2.1): remove it or keep it?": "Keep as a wrapper".

`@cofold/agents` goes to 0.3.0 all the same, because the two new events break an exhaustive event switch such as ahpd's.
Source: Softov, 2026-10-11, asked "ahpd's typecheck fails on the two new events, and its ^0.2.1 range would take a 0.2.2 automatically. Which version should agents get?": "0.3.0".

## Consequences

A program that calls `compact()` keeps working.
The run's input message is now the `command` message `/compact`, not the `system` ask.

## Options

Remove it: one entry point, but every caller changes.
