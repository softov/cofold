---
title: The declaration says what it does to what
status: implemented
depends: []
layer: "commands"
refs:
  - "[code://packages/commands/src/types/command.ts#L48-L178](../../../../packages/commands/src/types/command.ts#L48-L178) - `CommandDefinition` and `ActionDefinition`, which both gain the fields"
  - "[code://packages/commands/src/command.ts#L101-L131](../../../../packages/commands/src/command.ts#L101-L131) - the field-by-field copy in `commandFor`"
  - "[code://packages/commands/src/registry.ts#L320-L361](../../../../packages/commands/src/registry.ts#L320-L361) - `validateCommand`"
  - "[code://packages/commands/src/input.ts#L41](../../../../packages/commands/src/input.ts#L41) - `fieldsOf`, the input field names"
  - "[code://packages/commands/src/index.ts](../../../../packages/commands/src/index.ts) - the exports"
  - "[code://packages/commands/src/registry.test.ts#L90](../../../../packages/commands/src/registry.test.ts#L90) - the `registration` cases the new ones join"
---

## Objective

`ActionDefinition` and `CommandDefinition` take `effect?: Effect` and `resource?: Resource`, `commandFor` carries both onto the `Command`, and registration refuses an unknown effect, an empty `kind`, or a `key` that is not an input field, naming the command id.

## Files

- `UPDATE: packages/commands/src/types/command.ts` - `Effect` and `Resource` as in the plan's code block; `effect?` and `resource?` on both definitions, each with a doc comment.
- `UPDATE: packages/commands/src/command.ts` - `export const EFFECTS: readonly Effect[]`; `commandFor` spreads `effect` and `resource` when defined.
- `UPDATE: packages/commands/src/registry.ts` - three checks at the end of `validateCommand`.
- `UPDATE: packages/commands/src/index.ts` - export `EFFECTS`, and the types `Effect` and `Resource`.
- `UPDATE: packages/commands/src/registry.test.ts`, `packages/commands/src/command.test.ts` - the cases below.

## Steps

1. Tests first, with the types declared so they compile and fail on behaviour.
2. In `validateCommand`: `${command.id} declares the effect ${effect}, which is not one of read, add, change, remove`; `${command.id} declares a resource with no kind`; `${command.id} names ${key} as its resource key, which is not an input field` (checked against `fieldsOf(command).map((field) => field.name)`).
3. Copy the fields in `commandFor`.

## Validation

- `registry.action` with `effect: "remove"` and `resource: { kind: "pet", key: "id" }` and an `id` input: the `Command` has both, unchanged; fails first because `commandFor` drops them.
- A hand-built `Command` passed to `register` keeps both fields.
- `effect: "delete"` (cast), `resource: { kind: "" }`, and `key: "name"` with no `name` field are each refused with the id in the message; each fails first because nothing checks.
- `remove` with `resource: { kind: "plugin", key: "name" }` over a variadic `:name...` slot registers, and so does a key over a repeatable option.
- `add` with a key, and `change` with no resource, register: no combination is refused for having no role.
- An action with neither field registers as before; existing tests pass unchanged.
- `pnpm --filter @cofold/commands test` and `pnpm typecheck` are clean.

## Resume

Built 2026-10-06, awaiting review. `Effect` and `Resource` are in `types/command.ts` with doc comments that carry the role table, the no-role fallback and the list key. `EFFECTS` is in `command.ts`, the three checks are at the end of `validateCommand`, and `registry.ts` now imports `fieldsOf` from `input.ts`. Tests: six registration cases in `registry.test.ts` and two in `command.test.ts`. A hand-built `Command` already kept both fields before the change, because `register` stores the object as given.
