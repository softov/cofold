---
title: AGENT-03.1 - A runtime command is a run in the harness, and a client command never reaches the runtime
status: accepted
date: 2026-09-16
refs:
  - "[code://packages/agents/src/run/run.ts#L71-L115](../../packages/agents/src/run/run.ts#L71-L115) - `setupRun`, where a command line is recognized"
  - "[code://packages/papo/src/screen/app.tsx#L520-L540](../../packages/papo/src/screen/app.tsx#L520-L540) - papo's client copies of `/compact`, `/status` and the others"
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - `supportedCommands()` lists what Claude's runtime runs
---

## Context

papo runs `/compact` in the client, so the Claude backend shows two `/compact` commands and the harness does not know that a command exists.
pi runs its built-in commands in the terminal client, and only extension commands go through the session.

## Decision

A slash command is one of two kinds.
A runtime command is listed and run by the runtime: the harness, or Claude's CLI.
A client command belongs to the client and never reaches the runtime.

In the harness, a line that names a runtime command is a run with a run record, the writer claim and events.
The harness recognizes the line in `setupRun`, after the capabilities resolve.
The run writes the typed line as a `command` message and the output as a `notice` message.

Source: Softov, 2026-09-16: "this was supposed to be a harness command, something that came from the runner, not made in the client".

## Consequences

`wait`, `subscribe` and the store see a command run like any turn.
Each client lists the runtime's commands and adds only its own client commands.
A command run takes the writer claim, so it cannot run during another turn of the same session.

## Options

Commands in the client, as pi does: each client would carry its own copy, which is the defect that started this plan.
A direct call outside a run: no record, no events, and nothing in the transcript.
