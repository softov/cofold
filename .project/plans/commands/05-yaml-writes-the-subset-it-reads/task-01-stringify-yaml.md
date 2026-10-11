---
title: stringifyYaml writes what parseYaml reads
status: todo
depends: []
layer: "yaml"
refs:
  - "[code://packages/yaml/src/yaml.ts#L312-L336](../../../../packages/yaml/src/yaml.ts#L312-L336) - `scalar`, which decides which plain text needs quotes"
  - "[code://packages/yaml/src/yaml.ts#L127-L163](../../../../packages/yaml/src/yaml.ts#L127-L163) - `blockScalars`, the reader of `|`"
---

## Objective

`stringifyYaml(value)` answers YAML text that `parseYaml` reads back as the same value.

## Files

- `CREATE: packages/yaml/src/stringify.ts` - `stringifyYaml`.
- `UPDATE: packages/yaml/src/index.ts` - export `stringifyYaml`.
- `CREATE: packages/yaml/src/stringify.test.ts` - the round-trip cases.

## Steps

1. Write an object as a block mapping and an array as a block sequence, with two spaces of indent.
2. Write an empty object as `{}` and an empty array as `[]`.
3. Write a string with a newline as a literal block scalar, with the chomping indicator its last newline needs.
4. Quote a string that `scalar` would read as another type, or that starts with an indicator.
5. Quote a key that is not a plain key.
6. Write a number, a boolean and `null` as plain scalars.
7. Refuse `undefined`, a function, a symbol, a bigint, and a number that is not finite, with `YamlError`.
8. Skip an object key whose value is `undefined`, as `JSON.stringify` does.
9. Export `stringifyYaml` from `index.ts`.

## Validation

- `stringify.test.ts` checks that `parseYaml(stringifyYaml(v))` equals `v` for nested objects, arrays and empty values.
- The same test covers multi-line strings, with and without a last newline.
- The same test covers the strings `true`, `1`, `null`, `- a`, `a: b` and `#x`.
- A multi-line string comes out as a literal block scalar, not as one quoted line.
- `pnpm --filter @cofold/yaml test` passes.

## Resume
