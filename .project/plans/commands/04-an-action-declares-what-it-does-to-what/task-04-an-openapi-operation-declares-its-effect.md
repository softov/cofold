---
title: An OpenAPI operation declares its effect in x-cli
status: todo
depends: [task-03-the-manifest-carries-the-effect.md]
layer: "remote"
refs:
  - "[code://packages/remote/src/types/openapi.ts#L19-L26](../../../../packages/remote/src/types/openapi.ts#L19-L26) - `OpenApiOperationHint`, read from `x-cli` and from `hints`"
  - "[code://packages/remote/src/openapi.ts#L133](../../../../packages/remote/src/openapi.ts#L133) - the hint merge: `x-cli`, then `hints` by path, then by id"
  - "[code://packages/remote/src/openapi.ts#L180-L191](../../../../packages/remote/src/openapi.ts#L180-L191) - the `ManifestCommand` each operation becomes"
  - "[code://packages/remote/src/manifest.test.ts#L74](../../../../packages/remote/src/manifest.test.ts#L74) - the `reading OpenAPI` cases"
  - "[code://packages/remote/src/openapi.test.ts](../../../../packages/remote/src/openapi.test.ts) - the importer's own cases"
  - https://spec.openapis.org/oas/v3.1.0#specification-extensions - `x-` fields on an Operation Object
---

## Objective

An operation's `x-cli` (or a `hints` entry for it) may name `effect` and `resource`, and the imported `ManifestCommand` carries them; an unknown effect is an unsupported operation, reported through `onUnsupported` or thrown, like any other.

## Files

- `UPDATE: packages/remote/src/types/openapi.ts:19-26` - `effect?: Effect` and `resource?: Resource` on `OpenApiOperationHint`.
- `UPDATE: packages/remote/src/openapi.ts:180-191` - copy `hint.effect` and `hint.resource` into the `compact({...})`; refuse an effect not in `EFFECTS` inside the operation's `try`.
- `UPDATE: packages/remote/src/openapi.test.ts` - the cases below.

## Steps

1. Tests first.
2. Copy the fields; no effect is derived from the HTTP method.
3. Import only: writing an OpenAPI document from a registry is the ROADMAP item, not this task.

## Validation

- `"x-cli": { "effect": "remove", "resource": { "kind": "pet", "key": "petId" } }` on `DELETE /pets/{petId}` gives a command with both; fails first.
- `hints: { deletePet: { effect: "change" } }` overrides the document's `x-cli.effect`.
- `"x-cli": { "effect": "destroy" }` is reported through `onUnsupported` with the operation id, and throws without it.
- An operation with no hint has no `effect`, whatever its method.
- `pnpm --filter @cofold/remote test` is clean.

## Resume
