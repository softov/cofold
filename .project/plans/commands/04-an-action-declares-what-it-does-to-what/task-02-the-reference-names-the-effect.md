---
title: The reference names the effect and the resource
status: todo
depends: [task-01-the-declaration-says-what-it-does-to-what.md]
layer: "commands"
refs:
  - "[code://packages/commands/src/docs.ts#L71-L97](../../../../packages/commands/src/docs.ts#L71-L97) - `commandSection`; the `Needs:` line at 89 is the shape to copy"
  - "[code://packages/commands/src/docs.test.ts#L43](../../../../packages/commands/src/docs.test.ts#L43) - the `the reference` cases"
---

## Objective

A command with an effect gets one line in its reference entry, after `Needs:`: `Effect: remove`, with ` · Resource: \`pet\`` when it has a resource, and ` by \`id\`` when the resource has a key.

## Files

- `UPDATE: packages/commands/src/docs.ts:71-97` - the line, written only when `effect` or `resource` is set.
- `UPDATE: packages/commands/src/docs.test.ts` - the cases below.

## Steps

1. Tests first.
2. Add the line in `commandSection`; `agentSkill` is unchanged.

## Validation

- A command with `effect: "remove"` and `resource: { kind: "pet", key: "id" }` renders `Effect: remove · Resource: \`pet\` by \`id\``; fails first.
- A command with only a resource renders `Resource: \`pet\``.
- A command with neither renders exactly as today, and the existing reference tests pass unchanged.
- `pnpm --filter @cofold/commands test` is clean.

## Resume
