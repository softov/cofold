---
title: AGENT-03.6 - papo declares /status, /usage, /model and the other setting commands; the harness ships only /compact
status: accepted
date: 2026-09-16
refs:
  - "[code://packages/papo/src/agent.ts#L41-L73](../../packages/papo/src/agent.ts#L41-L73) - `buildAgent`, where papo declares them"
---

## Context

`/model`, `/reasoning`, `/permissions`, `/autocompact`, `/status`, `/usage`, `/config`, `/skills` and `/context` read or write papo's settings.
The harness does not know where a program keeps its settings.

## Decision

papo declares these as runtime commands in `buildAgent`, each one a closure over papo's store and settings.
The harness runs them and writes their output to the transcript.
The harness ships `/compact` only, because compaction is the harness's.

Source: Softov, 2026-09-16, with the list of internal commands; `/usage` replaces `/cost` (Softov, 2026-10-11).

## Consequences

A setting command writes the same settings record as the chips, so both agree.
Another program declares its own `/model`, or has none.

## Options

The harness ships `/model` and the setters: it would need a settings store that every program shares.
