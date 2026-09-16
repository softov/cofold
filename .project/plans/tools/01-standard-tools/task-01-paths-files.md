---
title: paths, files
status: done
depends: []
layer: tools
---

## Objective

paths, files.

## Files

- `CREATE: packages/tools/{package.json,tsconfig.json,tsconfig.test.json,README.md}`, `src/types/files.ts`, `src/paths.ts`, `src/files.ts`, `src/files.test.ts`, `UPDATE: vitest.workspace.ts`.

## Steps

(as the plan says)

## Validation

- read with offset/limit and numbering; binary refused; write creates parents; edit refuses zero and two matches, replaces one, `all` replaces every; glob skips `node_modules`; search returns `file:line:text` and respects `limit`; a `../` path resolves outside and says so in `resolveWithin`.

## Resume

Done; see the plan's Resume state.
