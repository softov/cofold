---
title: The docs describe the writer
status: done
depends: [task-01-stringify-yaml.md]
layer: "docs"
refs:
  - "[code://docs/commands/11-yaml.md](../../../../docs/commands/11-yaml.md) - the manual page"
  - "[code://packages/yaml/README.md](../../../../packages/yaml/README.md) - the package README"
---

## Objective

A reader of the manual page and the README knows that `stringifyYaml` exists and what it writes.

## Files

- `UPDATE: docs/commands/11-yaml.md` - a paragraph on `stringifyYaml`.
- `UPDATE: packages/yaml/README.md` - the import line names `stringifyYaml`.

## Steps

1. Write in `11-yaml.md` what `stringifyYaml` writes, and that `parseYaml` reads it back as the same value.
2. Add `stringifyYaml` to the import line in the README.

## Validation

- `rg -n "stringifyYaml" docs/commands/11-yaml.md packages/yaml/README.md` finds both.

## Resume

Built 2026-10-11, awaiting review. `11-yaml.md` has a paragraph on `stringifyYaml` after the `parseYaml` paragraph: what it writes, when multi-line text is quoted instead of a block, what it quotes, what it skips and what it refuses. The README import line names `stringifyYaml`.
