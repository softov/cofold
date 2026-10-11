---
title: AGENT-03.3 - The command and notice sources stay in the transcript and out of every request; the skill source goes to the model
status: accepted
date: 2026-09-16
refs:
  - "[code://packages/agents/src/types/message.ts#L34](../../packages/agents/src/types/message.ts#L34) - `MessageSource`"
  - "[code://packages/agents/src/run/context.ts#L45-L50](../../packages/agents/src/run/context.ts#L45-L50) - `contextOf`, which picks what a request carries"
---

## Context

A command run writes the typed line and the output, and the model must not read either.
A skill expansion writes the skill's text, and the model must read it.
The `system` source already exists, but it goes to the model.

## Decision

`MessageSource` gets `command`, `notice` and `skill`.
`contextOf` leaves out `command` and `notice` messages.
A `skill` message goes to the model like an `input` message.

Source: Softov, 2026-09-16, for `command` and `notice`. `skill` is (defaulted: the expansion needs a message the model reads and a client can show small).

## Consequences

A client shows a `command` message as the person's line, a `notice` message as a runtime line, and a `skill` message as one collapsed line.
A program that reads sources, such as ahpd's transcript, shows the new sources as user text until it maps them.

## Options

Reuse `system` for the output: the model would read `Compacted` on every later request.
Put the skill's text in the input message: the transcript would show the whole skill as the person's words.
