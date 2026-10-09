---
title: The file tools take requireRead
status: done
depends: []
layer: "tools"
refs:
  - "[code://packages/tools/src/files.ts#L45-L55](../../../../packages/tools/src/files.ts#L45-L55) - `files` and `fileTools`"
  - "[code://packages/tools/src/files.ts#L113-L150](../../../../packages/tools/src/files.ts#L113-L150) - the two `assertCurrent` calls"
  - "[code://packages/tools/src/standard.ts#L12-L59](../../../../packages/tools/src/standard.ts#L12-L59) - `TOOLS_SCHEMA` and `standardCapabilities`"
---

## Objective

`files({ requireRead: false })` and a `tools` config with `files: { requireRead: false }` turn off the refusal of an unread or changed file.

## Files

- `UPDATE: packages/tools/src/types/files.ts:1` - `FilesOptions.requireRead?: boolean`, with a comment that says the default is `true`.
- `UPDATE: packages/tools/src/files.ts:45-55` - `files` passes `requireRead` to `fileTools`.
- `UPDATE: packages/tools/src/files.ts:113-150` - `write_file` and `edit_file` call `assertCurrent` only when `requireRead` is not `false`.
- `UPDATE: packages/tools/src/types/standard.ts:11-18` - `files?: boolean | { requireRead?: boolean }`.
- `UPDATE: packages/tools/src/standard.ts:12-59` - `TOOLS_SCHEMA` takes the object form with `additionalProperties: false`; `standardCapabilities` passes it to `files`.
- `UPDATE: packages/tools/src/files.test.ts` - the cases for the option.
- `UPDATE: packages/tools/src/standard.test.ts` - the cases for the config and the schema.
- `UPDATE: packages/tools/README.md` - the option and the config key.

## Steps

1. Add `requireRead` to `FilesOptions`.
2. Pass it from `files` to `fileTools`.
3. Skip `assertCurrent` in both tools when `requireRead` is `false`.
4. Keep `remember` after each read and write in every case.
5. Widen `ToolsConfig.files` and `TOOLS_SCHEMA.properties.files` to the object form.
6. Pass the object's `requireRead` from `standardCapabilities` to `files`.
7. Add a case: with `requireRead: false`, an edit of an unread file succeeds.
8. Add a case: with `requireRead: false`, a write to a file that changed since the read succeeds.
9. Add a case: with no option, cofold refuses both writes as before.
10. Add a case: `files: { requireRead: false }` passes the schema, and `files: { other: true }` fails it.
11. Document the option and the config key in the README.

## Validation

- `pnpm build`, `pnpm typecheck` and `pnpm test` pass.
- The existing refusal cases pass with no change.

## Resume

- None.
