---
title: "@cofold/yaml writes the subset it reads - implemented"
date: 2026-10-11
refs:
  - git://4174eeb - the 0.3.0 version bump, released as @cofold/yaml 0.3.0
  - git://f29634c - the writer quotes `<<`, and the reader reads a quoted `<<` as a key
  - git://88227e0 - the writer quotes text a YAML 1.2 core reader reads as another type
  - "[code://packages/yaml/src/stringify.ts](../../../../packages/yaml/src/stringify.ts) - `stringifyYaml`"
---

`@cofold/yaml` has `stringifyYaml`, which writes a JSON value as YAML in the subset `parseYaml` reads.
A multi-line string is a literal block scalar, so a long prompt reads as text in the file.

## What was built

- [`code://packages/yaml/src/stringify.ts`](../../../../packages/yaml/src/stringify.ts) - the writer, with no I/O.
- [`code://packages/yaml/src/yaml.ts`](../../../../packages/yaml/src/yaml.ts) - `parseYaml` reads a quoted `"<<"` as an ordinary key.
- [`code://docs/commands/11-yaml.md`](../../../../docs/commands/11-yaml.md) - the manual page describes the writer.

## Verified

- `packages/yaml/src/stringify.test.ts` has 22 tests, and each one writes a value, reads it back and compares the two.
- On 2026-10-15, `pnpm build`, `pnpm -r typecheck` and `pnpm test` pass at the repository root: 77 files and 1027 tests.

## Departures from the plan

- The plan did not name the key `<<` or the YAML 1.2 core types. Two commits after the review settled both, and the plan's second table records them.

## Left for later

- None.
