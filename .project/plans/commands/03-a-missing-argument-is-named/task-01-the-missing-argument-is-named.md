---
title: The missing argument is named
status: implemented
depends: []
layer: "terminal"
refs:
  - "[code://packages/terminal/src/program.ts#L129-L142](../../../../packages/terminal/src/program.ts#L129-L142) - the `unknown command` branch"
---

## Objective

A parse with no command whose typed words equal a visible command's literal prefix prints `<program>: "<words>" needs <slot>.` followed by that command's usage, and exits 2.

## Files

- `UPDATE: packages/terminal/src/program.ts` - the branch before `unknown command`.
- `UPDATE:` the terminal's program tests.

## Steps

1. Tests first: a program with `note add :text` and `plugin install :name...`; `note add` and `plugin install` each name their slot; `note ad` still gets `unknown command` and its suggestion.
2. Implement.

## Validation

- The new cases fail first and pass after; the repository's typecheck and tests.

## Resume

Built 2026-10-06, awaiting review. The branch in `program.ts` runs before `unknown command`: the first visible command whose literal prefix equals the typed words names its first required slot, then `Usage: <program> <pattern>` unstyled on stderr, exit 2. Tests: four cases in `program.test.ts`, including the one pinning that the first of two commands sharing the words is the one named.
