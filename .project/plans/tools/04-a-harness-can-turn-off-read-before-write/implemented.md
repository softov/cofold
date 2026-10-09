---
title: A harness can turn off the rule that a write needs a read first - implemented
date: 2026-10-09
refs:
  - git://release-2026-10-09-2
  - "[code://packages/tools/src/files.ts](../../../../packages/tools/src/files.ts)"
  - "[code://packages/tools/src/standard.ts](../../../../packages/tools/src/standard.ts)"
---

`files({ requireRead: false })` lets a write reach a file the session did not read, or that changed since the read.
The rule stays on when the key is absent.
The re-check of the opened file against the checked path stays on in every case.
`TOOLS_SCHEMA` takes `files` as a boolean or `{ requireRead }`, and `standardCapabilities` passes the key through.

## What was built

- [`code://packages/tools/src/files.ts`](../../../../packages/tools/src/files.ts) - `requireRead` in `FilesOptions`, read by `write_file` and `edit_file`.
- [`code://packages/tools/src/standard.ts`](../../../../packages/tools/src/standard.ts) - the object form of `files` in `TOOLS_SCHEMA` and `standardCapabilities`.

## Verified

- `pnpm check` passes in cofold.
- ahpd plugin 40 passed against a packed tarball before the release.
- ahpd main `9c5491e` runs on the published 0.4.0, and an edit of an unread file succeeds with `requireRead: false`.

## Departures from the plan

- none.

## Left for later

- none.
