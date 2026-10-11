---
title: AGENT-03.5 - papo queues a slash line typed while a turn runs, and never steers it
status: accepted
date: 2026-10-11
refs:
  - "[code://packages/papo/src/chat.ts#L444-L458](../../packages/papo/src/chat.ts#L444-L458) - `say` steers text into a running turn"
  - "[papo-steers-and-queues](papo-steers-and-queues.md) - the queue this uses"
---

## Context

papo's `say` steers text into a running turn.
A `/compact` typed during a turn would reach the model as text, and the runtime would never run it.

## Decision

`say` puts a line that starts with `/` in the session's queue while a turn runs.
The line starts as a new turn when the running turn settles, so the runtime reads it.

Source: Softov, 2026-10-11, asked "A slash command typed while a turn runs: what happens to it?": "Queue it".

## Consequences

A person cannot steer a line that starts with `/` into a turn.
The harness's `steer` does not recognize commands; a program that steers a slash line sends text to the model.

## Options

Refuse the line: the person types it again.
Steer it as text: the runtime never runs it.
