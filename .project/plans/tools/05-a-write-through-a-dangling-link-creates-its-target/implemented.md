---
title: "Implemented: a write through a dangling link creates its target"
---

# Implemented: a write through a dangling link creates its target

## What exists now

`openChecked` in `packages/tools/src/files.ts` creates a missing file at `resolved.real`, the path its `stat` checked.
For a dangling link, that is the target, and the folders of the target are made first.
The open uses `wx`, so a file or link put at the target first fails the write with "changed".

## What was verified

- A test in `packages/tools/src/files.test.ts`: a write through a dangling link creates its target and keeps the link.
- A test in the same file: a file put at the target before the open fails the write and keeps its content.
- `pnpm check` passes with 969 tests.
- ahpd plugin/40's agent-cofold suite ran against the packed package, with the agent/08 store-file: 200 of 200 pass, both dangling-link rows included.

## Departures from the plan

None. The version is unchanged; the release is Softov's.
