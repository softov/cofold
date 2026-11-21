---
title: copapo uses the cofold names - implemented
date: 2026-11-21
refs:
  - "[code://packages/copapo/src/config.ts](../../../../packages/copapo/src/config.ts) - the resolver name, the project file and the variables"
  - "[code://packages/copapo/src/trust.ts](../../../../packages/copapo/src/trust.ts) - the gated project file and the user file trust reads"
  - "[code://packages/copapo/README.md](../../../../packages/copapo/README.md) - the files and variables a person sets"
---

copapo reads one set of names, the family's: `~/.config/cofold/config.json`, `.cofold.json`, `COFOLD_CONFIG` and `COFOLD_*`. The old copapo names are not read, with no fallback, as the plan answered. The command and the names of the program stay `copapo`.

Verified on 2026-11-21:

- The copapo tests pass in one fork: 16 files, 221 tests. `pnpm --filter @cofold/copapo typecheck` passes.
- `rg` finds no copapo file or variable name in `packages`, `examples`, `docs` or the root README, except the case that checks they are ignored.
- By hand, with a temporary config home: `COFOLD_BASE_URL` alone gives the `default` provider. `COPAPO_BASE_URL` alone gives none, and the message names `COFOLD_BASE_URL`. `copapo trust` writes `cofold/config.json`.

`deferred.md` keeps ahpd's side, which waits for the release.
