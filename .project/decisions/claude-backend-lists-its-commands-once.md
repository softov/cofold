---
title: AGENT-03.7 - On the Claude backend, commands() is supportedCommands() and skills() is empty
status: accepted
date: 2026-09-16
refs:
  - "[code://packages/papo/src/claude/chat.ts#L356-L359](../../packages/papo/src/claude/chat.ts#L356-L359) - `skills()` maps `supportedCommands()` today"
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - `supportedCommands()` lists commands and skills in one list
---

## Context

The Claude SDK lists its commands and its skills in one list and does not say which is which.

## Decision

`commands()` returns `supportedCommands()`, and `skills()` returns an empty list.
`say('/x')` goes to the CLI unchanged.

Source: Softov, 2026-09-16.

## Consequences

The `/` menu shows each Claude entry once.
papo cannot show Claude's skills apart from its commands until the SDK tells them apart.

## Options

Keep both lists and remove duplicates by name: the menu would still mix commands and skills under one label.
