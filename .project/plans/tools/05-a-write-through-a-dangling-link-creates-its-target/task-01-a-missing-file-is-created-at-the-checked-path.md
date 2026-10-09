---
title: A missing file is created at the path that was checked
status: done
depends: []
layer: "tools"
refs:
  - "[code://packages/tools/src/files.ts#L302-L331](../../../../packages/tools/src/files.ts#L302-L331) - `openChecked`"
  - "[code://packages/tools/src/files.test.ts#L130-L175](../../../../packages/tools/src/files.test.ts#L130-L175) - the link tests of the write tools"
---

## Objective

`openChecked` creates a missing file at `resolved.real`, so a write through a dangling link creates its target.

## Files

- `UPDATE: packages/tools/src/files.ts:302-331` - the create branch makes the folders of `resolved.real` and opens `resolved.real` with `wx`; the doc comment says so.
- `UPDATE: packages/tools/src/files.test.ts` - tests for a write through a dangling link.

## Steps

1. In `openChecked`, call `mkdir` on `dirname(resolved.real)`.
2. Open `resolved.real` with `wx` in place of `resolved.absolute`.
3. Keep the EEXIST error as `changed(shown)`.
4. Update the doc comment of `openChecked` to name the path the create opens.
5. Add a test: `write_file` through `dl` to a missing target creates the target, and `dl` is still a link.
6. Add a test: a file put at the target before the open fails the write and keeps its content.
7. Run `pnpm check`.

## Validation

- `files.test.ts`: a write through a dangling link creates the target with the text, and the link stays.
- `files.test.ts`: a file put at the target first is not changed, and the write fails.
- `files.test.ts`: the current link tests pass unchanged.
- `pnpm check` passes.

## Resume

- 2026-10-09: implemented. `openChecked` creates a missing file at `resolved.real`. Two tests added to `files.test.ts`. `pnpm check` passes: 75 files, 969 tests.
