---
title: A file field is a path
status: todo
depends: []
layer: "commands"
refs:
  - "[code://packages/commands/src/coerce.ts#L177](../../../../packages/commands/src/coerce.ts#L177) - `timestamp`, the schema-only coercer that `file` copies"
  - "[code://packages/commands/src/input.ts#L41](../../../../packages/commands/src/input.ts#L41) - `fieldsOf`, which `hasFileInput` reads"
  - "[code://packages/commands/src/index.ts#L46](../../../../packages/commands/src/index.ts#L46) - the export line for `input.js`"
---

## Objective

`coerce.file` declares an option whose value is a path to a file, as a string schema with `format: "file"`.
`hasFileInput(command)` says whether a command has such a field, so that `@cofold/remote` and `@cofold/mcp` ask one function.

## Files

- `UPDATE: packages/commands/src/coerce.ts:177` - add `file` after `timestamp`: schema `{ type: "string", format: "file" }`, `expects: "a path to a file"`.
- `UPDATE: packages/commands/src/input.ts:41` - add `hasFileInput(command)` after `fieldsOf`; it is true when a field schema, or its `items`, has `format: "file"`.
- `UPDATE: packages/commands/src/index.ts:46` - export `hasFileInput` beside `fieldsOf`.
- `UPDATE: packages/commands/src/coerce.test.ts` - the cases in Validation for `file`.
- `UPDATE: packages/commands/src/input.test.ts` - the cases in Validation for `hasFileInput`.

## Steps

1. Add `file` to `coerce.ts` with the schema, `expects` and a one-line doc comment, and no `parse`.
2. Keep `coerce.ts` free of Node imports, because `@cofold/remote` checks the file.
3. Add `hasFileInput` to `input.ts`, reading `fieldsOf(command)`.
4. Export `hasFileInput` from `index.ts`.
5. Write the tests.

## Validation

- `coerce.test.ts`: `coerceValue(file, "./a.png", "--file")` returns `"./a.png"`; the schema is `{ type: "string", format: "file" }`.
- `input.test.ts`: `hasFileInput` is true for an option with `coerce.file`, and for a repeated one.
- `input.test.ts`: `hasFileInput` is false for a command with text options only.
- `pnpm --filter @cofold/commands test` passes.

## Resume
