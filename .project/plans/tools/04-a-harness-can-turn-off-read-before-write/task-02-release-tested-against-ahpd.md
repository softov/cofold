---
title: The change is tested against ahpd before any release
status: todo
depends: [task-01-the-file-tools-take-require-read.md]
layer: "tools"
refs:
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan whose suite tests the change
---

## Objective

ahpd's agent-cofold suite passes against a packed `@cofold/tools` that has task 01.
The version and the release are Softov's; this task changes neither.

## Files

- `UPDATE: packages/tools/package.json` - no change; the version stays until Softov chooses one.

## Steps

1. Run `pnpm pack` in `packages/tools`.
2. Install the tarball in an ahpd worktree that has plugin 40 tasks 01-08 built.
3. Run ahpd's agent-cofold suite against it.
4. Report the result to Softov.

## Validation

- ahpd's agent-cofold suite passes against the packed tarball.

## Resume

- ahpd plugin 40 tasks 01-08 come first; its task 09 takes the release Softov makes.
