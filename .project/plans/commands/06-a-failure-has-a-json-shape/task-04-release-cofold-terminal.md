---
title: Release @cofold/terminal
status: todo
depends:
  - task-03-the-manual-shows-a-failure-under-json.md
layer: release
refs:
  - "[code://packages/terminal/package.json#L3](../../../../packages/terminal/package.json#L3) - the version, 0.3.0 now"
---

## Objective

Softov publishes `@cofold/terminal` 0.4.0 with the JSON failure.
ahpd daemon/32 then bumps its dependency.

## Files

- `UPDATE: packages/terminal/package.json:3` - the version goes to 0.4.0.

## Steps

1. Run ahpd's tests against a local build of the package, as a release candidate.
2. Set the version to 0.4.0.
3. Name the change of the failure line under `--json` in the release commit and the release notes.
4. Tell Softov that the release is ready, and wait for him to publish it.
5. Set this task and the plan row to `implemented` after the publish.

## Validation

- ahpd's server tests pass against the candidate.
- `npm view @cofold/terminal version` prints 0.4.0 after the publish.

## Resume
