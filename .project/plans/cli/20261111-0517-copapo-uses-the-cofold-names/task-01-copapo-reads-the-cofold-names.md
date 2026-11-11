---
title: copapo reads the cofold names
status: todo
depends: []
layer: "copapo"
refs:
  - "[code://packages/copapo/src/config.ts#L87-L138](../../../../packages/copapo/src/config.ts#L87-L138) - the resolver name, the project file, the variables"
  - "[code://packages/copapo/src/trust.ts#L26-L65](../../../../packages/copapo/src/trust.ts#L26-L65) - the gated project file and the user file trust reads"
  - "[code://packages/copapo/src/commands.ts#L93](../../../../packages/copapo/src/commands.ts#L93) - `COPAPO_WORKSPACE`"
---

## Objective

copapo reads `~/.config/cofold/config.json`, `.cofold.json`, `COFOLD_CONFIG` and the `COFOLD_*` variables.
It reads no copapo-named file or variable.

## Files

- `UPDATE: packages/copapo/src/config.ts:87-158` - resolver name `cofold`, project `.cofold.json`, `COFOLD_*` only, `userConfigPath` under `cofold`, the doc comments.
- `UPDATE: packages/copapo/src/trust.ts:26-65` - `gatedFiles` looks for `.cofold.json`; `trustOf` resolves under `cofold`.
- `UPDATE: packages/copapo/src/commands.ts` - `COFOLD_WORKSPACE`, and the names in the `models`, `trust` and `Copapo.trusted` texts.
- `UPDATE: packages/copapo/src/chat.ts` - the three "no provider is configured" errors name `COFOLD_BASE_URL` and `~/.config/cofold/config.json`.
- `UPDATE: packages/copapo/src/screen/trust.ts:14` - the trust question names `.cofold.json`.
- `UPDATE: packages/copapo/src/types/config.ts:40` - the doc comment.
- `UPDATE: packages/copapo/src/config.test.ts` - the cases use the new names; the case where `COPAPO_*` wins over `COFOLD_*` becomes one where `COPAPO_*` is ignored.
- `UPDATE: packages/copapo/src/trust.test.ts` - `.cofold.json`.
- `UPDATE: packages/copapo/src/commands.test.ts` - `.cofold.json`.
- `UPDATE: packages/copapo/src/chat.test.ts` - the error text.
- `UPDATE: packages/copapo/src/screen/screen.test.ts` - `.cofold.json`.
- `UPDATE: packages/copapo/src/acp/server.test.ts` - `.cofold.json`.
- `UPDATE: packages/copapo/src/acp/contract.test.ts` - `.cofold.json`.
- `CREATE: .project/pending/merge-the-cofold-user-file.md` - Softov merges `~/.config/copapo/config.json` into `~/.config/cofold/config.json`.

## Steps

1. Change the resolver name in `loadConfig`, `rememberConfig` and `trustOf` to `cofold`.
2. Change `projectOf` and `gatedFiles` to `.cofold.json`.
3. Change `userConfigPath` to `<config home>/cofold/config.json`.
4. Read `COFOLD_BASE_URL`, `COFOLD_API_KEY`, `COFOLD_MODEL` and `COFOLD_BACKEND` alone, and remove the `COPAPO_*` lookup.
5. Change the `--workspace` variable to `COFOLD_WORKSPACE`.
6. Change every message and doc comment that names a copapo file or variable.
7. Keep `COPAPO_APP`, `AGENT_ID`, `agentInfo` and `clientInfo` as they are.
8. Update the tests, and add a case that `COPAPO_BASE_URL` alone adds no provider.
9. Write the pending file for Softov's merge.

## Validation

- `packages/copapo/src/config.test.ts`: `COFOLD_*` adds the `default` provider; `COPAPO_*` adds nothing; a trusted folder loads `.cofold.json`; `COFOLD_CONFIG` names a file.
- `packages/copapo/src/trust.test.ts`: trust gates `.cofold.json`, and reads its answers from `~/.config/cofold/config.json`.
- `pnpm --filter @cofold/copapo typecheck` passes, and the copapo tests pass in one fork.
- `rg -n "COPAPO_(CONFIG|BASE_URL|API_KEY|MODEL|BACKEND|WORKSPACE)|\.copapo\.json|config/copapo" packages/copapo/src` finds nothing.

## Resume
