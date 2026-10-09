---
title: The change is tested against ahpd before any release
status: done
depends: [task-01-append-event-writes-in-call-order.md]
layer: "store-file"
refs:
  - file:///github/ahpd/.project/plans/plugin/40-ahpd-runs-on-the-current-cofold/plan.md - the ahpd plan whose suite tests the change
---

## Objective

ahpd plugin/40's agent-cofold suite passes against a packed `@cofold/store-file` that has task 01.
The version and the release are Softov's; this task changes neither.

## Files

- `UPDATE: packages/store-file/package.json` - no change; the version stays until Softov chooses one.

## Steps

1. Run `pnpm pack` in `packages/store-file`.
2. Install the tarball in the ahpd worktree that has plugin 40 tasks 01-08 built.
3. Run ahpd's agent-cofold suite against it.
4. Report the result to Softov.

## Validation

- The plugin/40 tests that failed with `seq_gap` pass against the packed tarball.

## Resume

The packed store-file ran in `/github/ahpd.worktrees/review-p40` on 2026-10-09: agent-cofold went from 17 failures to 2, and no `seq_gap` failure is left. The two left are the dangling-link rows, a tools 0.3.0 matter. The version is unchanged.
