---
title: The manifest carries the effect and the resource
status: done
depends: [task-01-the-declaration-says-what-it-does-to-what.md]
layer: "remote"
refs:
  - "[code://packages/remote/src/types/manifest.ts#L38-L47](../../../../packages/remote/src/types/manifest.ts#L38-L47) - `ManifestCommand`"
  - "[code://packages/remote/src/manifest.ts#L72-L104](../../../../packages/remote/src/manifest.ts#L72-L104) - `manifestFrom`, the server half"
  - "[code://packages/remote/src/manifest.ts#L143-L186](../../../../packages/remote/src/manifest.ts#L143-L186) - `commandsFrom`, the client half"
  - "[code://packages/remote/src/manifest.test.ts#L25](../../../../packages/remote/src/manifest.test.ts#L25) - the `the round trip` cases"
---

## Objective

`manifestFrom` writes `effect` and `resource` into each `ManifestCommand` that has them, and `commandsFrom` puts them back on the `Command` it builds, so a remote `remove` is confirmed by the client's terminal like a local one.

## Files

- `UPDATE: packages/remote/src/types/manifest.ts:38-47` - `effect?: Effect` and `resource?: Resource` on `ManifestCommand`, imported from `@cofold/commands`.
- `UPDATE: packages/remote/src/manifest.ts:85-95` - both fields inside the existing `compact({...})`.
- `UPDATE: packages/remote/src/manifest.ts:175-179` - the same in `commandsFrom`.
- `UPDATE: packages/remote/src/manifest.test.ts` - the cases below.

## Steps

1. Tests first.
2. Add the fields; `MANIFEST_VERSION` stays 1.

## Validation

- A registry with `pet.remove` (`effect: "remove"`, `resource: { kind: "pet", key: "id" }`) gives a manifest entry with both; fails first.
- `commandsFrom(manifestFrom(...))` gives a `Command` with both, and that `Command` registers, which checks the key against the rebuilt input fields.
- A command with neither has no `effect` or `resource` key in the manifest (no `undefined` field).
- `pnpm --filter @cofold/remote test` is clean.

## Resume

Built 2026-10-06, awaiting review. Both fields sit inside the existing `compact` calls of `manifestFrom` and `commandsFrom`. Tests: two cases in `manifest.test.ts`, the round trip registering the rebuilt command.
