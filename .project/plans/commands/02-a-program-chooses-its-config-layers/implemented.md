---
title: A program chooses its configuration layers and names its project file - implemented
date: 2026-09-28
refs:
  - git://c7835d6
  - npm://@cofold/config@0.3.0 - the release that carries it, tag `release-2026-09-28-2`
  - "[code://packages/config/src/index.ts](../../../../packages/config/src/index.ts) - `resolveConfig` and `findUp`"
  - "[code://packages/config/src/types/config.ts](../../../../packages/config/src/types/config.ts) - `user`, `project` and `environment` on `ConfigOptions`"
---

A program using `@cofold/config` reads a project file only when it names one, by any name, found upward from the working directory, and can turn off the user file and the environment variable.
papo names `.papo.json` and reads what it read before; ahpd names none.

## What was built

- [`code://packages/config/src/types/config.ts`](../../../../packages/config/src/types/config.ts) - `user?: boolean`, `project?: string`, `environment?: string | false`.
- [`code://packages/config/src/index.ts`](../../../../packages/config/src/index.ts) - each layer gated on its option; `findUp` joins the given name to each directory as written.
- [`code://packages/papo/src/config.ts`](../../../../packages/papo/src/config.ts) - both calls pass `project: '.papo.json'`.
- [`code://packages/config/README.md`](../../../../packages/config/README.md) and [`code://docs/commands/10-config.md`](../../../../docs/commands/10-config.md) - the options, and that the project file is opt-in.

## Verified

- [`code://packages/config/src/index.test.ts`](../../../../packages/config/src/index.test.ts) - 7 new cases; `pnpm typecheck` clean and `pnpm test` 71 files and 849 tests.
- Softov checked on 2026-09-28: `papo config` in a subdirectory read `.papo.json` two levels up, and did not read it once renamed to `papo.json`; ahpd's daemon ignored `ahpd.json` and `.ahpd.json`.

## Departures from the plan

- `extensions` applies to the user file only; the project file is found by the exact name given.

## Left for later

- Nothing.
