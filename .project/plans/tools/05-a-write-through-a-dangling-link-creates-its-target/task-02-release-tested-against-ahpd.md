---
title: The change is tested against ahpd before any release
status: done
depends: [task-01-a-missing-file-is-created-at-the-checked-path.md]
layer: "tools"
refs:
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan whose suite tests the change
---

## Objective

ahpd plugin/40's agent-cofold suite passes against a packed `@cofold/tools` that has task 01.
The version and the release are Softov's; this task changes neither.

## Files

- `UPDATE: packages/tools/package.json` - no change; the version stays until Softov chooses one.

## Steps

1. Run `pnpm pack` in `packages/tools`.
2. Install the tarball in the ahpd worktree that has plugin 40 tasks 01-08 built.
3. Run ahpd's agent-cofold suite against it.
4. Report the result to Softov.

## Validation

- The two dangling-link rows in `agent-cofold-tools.test.ts` pass against the packed tarball.

## Resume

On 2026-10-09 the packed tools ran in `/github/ahpd.worktrees/review-p40`, with the store-file fix in place: agent-cofold passes 200 of 200, and both dangling-link rows pass. The version is unchanged.
