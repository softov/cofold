---
title: The layers and the project file name are options
status: implemented
depends: []
layer: "config"
refs:
  - "[code://packages/config/src/index.ts#L75-L157](../../../../packages/config/src/index.ts#L75-L157) - `resolveConfig` and `findUp`"
  - "[code://packages/config/src/types/config.ts](../../../../packages/config/src/types/config.ts) - `ConfigOptions`"
---

## Objective

`resolveConfig` takes `user`, `project` and `environment` options. It reads a project file only when `project` names one, found upward by that name, and skips the user or environment layer set to `false`.

## Files

- `UPDATE: packages/config/src/types/config.ts` - `ConfigOptions` gains `user?: boolean`, `project?: string` and `environment?: string | false`, each with a doc comment saying what absent means.
- `UPDATE: packages/config/src/index.ts:75-157` - the user layer runs unless `user === false`; the project layer looks for `project` when it is set and not at all when it is absent; the environment layer reads the named variable, `environmentNameOf(name)` when absent, nothing when `false`.
- `UPDATE: packages/config/src/index.test.ts` - the cases below.
- `UPDATE: packages/config/README.md`, `docs/commands/10-config.md` - the three options, and that the project file is opt-in.
- `UPDATE: packages/papo/src/config.ts:131,186` - pass `project: '.papo.json'`.

## Steps

1. Write the tests first, with `readFile`, `env`, `cwd` and `home` injected.
2. Pass the file name to `findUp` instead of building `.<name><ext>` inside it; `extensions` does not apply to it.
3. Gate each layer on its option.

## Validation

- `project: "ahpd.json"` finds `ahpd.json` two directories up and not `.ahpd.json`.
- `project: ".ahpd/config.json"` finds that path upward.
- No `project` reads no project file, with a `.<name>.json` present; `user: false` and `environment: false` each leave that layer out of `layers` and `values`.
- `environment: "OTHER_CONFIG"` reads that variable.
- The existing project-layer tests pass with `project` given; papo's config tests pass unchanged.
- `pnpm test` and `pnpm typecheck` in cofold are clean.

## Resume

- Built 2026-09-28, test first, in the worktree `/github/.worktrees/cofold-config-layers` (branch `config-layers` off `main` 58e82be), uncommitted, awaiting review.
- `ConfigOptions` gained the three option declarations before the tests, so the tests compile and fail on behaviour. Seven new cases in "choosing the layers" each failed first against the old resolver: `ahpd.json` and `.ahpd/config.json` both read `/repo/a/.ahpd.json` ("dotted"), no `project` still gave `["user", "project"]`, `user: false` still gave `["user", "project"]`, `environment: false` still read `DEPOT_CONFIG`, and `environment: "OTHER_CONFIG"` and the explicit-only case threw on `DEPOT_CONFIG` pointing at a missing file.
- The existing project-layer tests use `withProject` (`project: ".depot.json"`); the parser test passes `project: ".depot.conf"`, because `extensions` no longer applies to the project file.
- papo's config tests fail (2 of 18) without `project: '.papo.json'` and pass with it.
- `pnpm typecheck` clean; `pnpm test` 71 files, 849 tests, no type errors (842 before, plus 7).
