---
title: 121 - An action declares its effect and its resource, and its role follows from them
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/commands/src/types/command.ts#L48-L178](../../packages/commands/src/types/command.ts#L48-L178) - `CommandDefinition` and `ActionDefinition`, which carry the two fields"
  - "[code://packages/commands/src/types/command.ts#L95](../../packages/commands/src/types/command.ts#L95) - `meta`, the untyped extension point the fields do not go in"
---

## Context

A client that draws a program's surface without knowing it, such as ahpd-web's resource explorer, needs to know what each action does and what it acts on.
It needs a list, a create, and item actions with the key filled in.
Nothing on a declaration says that today.

## Decision

`ActionDefinition` and `CommandDefinition` in `@cofold/commands` carry two typed fields, not in `meta`: `effect?: 'read' | 'add' | 'change' | 'remove'` and `resource?: { kind: string; key?: string }`.
`key` names the input field that names one item, and it is the same field in each row a list of that kind returns.
A role is never declared: a list is `read` with no key, a get is `read` with a key, a create is `add` with no key, and an item action is `change` or `remove` with a key.

Source: Softov, 2026-10-06, asked "is this the shape: effect plus resource?": "effect + resource"; in his words, "identify the command as additive, something that changes, something destructive and the resource kind".

## Consequences

Every surface derives what it needs from the same two fields: the manifest publishes them, MCP derives its hints, the terminal asks before a `remove`.
A client works out the role itself from effect and key.
Registration checks the effect and that the key is an input field; that list rows carry the key is a contract nothing checks.

## Options

- An explicit `role: list | create | item` with `rowKey` and `annotations` - lost, because the role follows from effect and key, so stating it would be a second statement that can disagree with the first.
- The fields in `meta` - lost, because `meta` is untyped and ignored by the core, and every surface reads these.
