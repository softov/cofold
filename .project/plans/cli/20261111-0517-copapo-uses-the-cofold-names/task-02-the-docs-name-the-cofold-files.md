---
title: The docs name the cofold files
status: todo
depends: [task-01-copapo-reads-the-cofold-names.md]
layer: "docs"
refs:
  - "[code://packages/copapo/README.md#L13-L30](../../../../packages/copapo/README.md#L13-L30) - the files and variables a person sets"
  - "[code://README.md#L72](../../../../README.md#L72) - the example command"
---

## Objective

copapo's README and the root README name only the cofold files and variables.

## Files

- `UPDATE: packages/copapo/README.md` - the user and project files, `COFOLD_CONFIG`, the provider variables, `COFOLD_BACKEND`, `COFOLD_WORKSPACE`, the trust and remembered-settings sections.
- `UPDATE: README.md:72` - the example uses `COFOLD_BASE_URL`.

## Steps

1. Replace each copapo file and variable name in copapo's README with the cofold name.
2. Remove the sentence that says `COFOLD_*` works too and `COPAPO_*` wins.
3. Change the root README example to `COFOLD_BASE_URL`.

## Validation

- `rg -n "COPAPO_|\.copapo\.json|config/copapo" packages/copapo/README.md README.md` finds only `COPAPO_APP`, if the README names it.

## Resume
