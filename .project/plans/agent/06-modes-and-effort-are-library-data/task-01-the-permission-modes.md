---
title: The permission modes and what each does are library data
status: done
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/types/policy.ts#L19-L26](../../../../packages/agents/src/types/policy.ts#L19-L26) - `PermissionMode` and its doc comment"
  - "[code://packages/agents/src/policy/modes.ts#L33-L66](../../../../packages/agents/src/policy/modes.ts#L33-L66) - `policyOf`, whose cases the descriptions must match"
  - "[code://packages/agents/src/index.ts#L8](../../../../packages/agents/src/index.ts#L8) - the `policyOf` export"
  - file:///github/ahpd/packages/agent-cofold/src/agent.ts - lines 124 and 137-144, the list and the descriptions to move
---

## Objective

`@cofold/agents` exports `PERMISSION_MODES`, the six modes in a fixed order, and `PERMISSION_MODE_DESCRIPTIONS`, one plain sentence per mode that says what `policyOf` does with it.

## Files

- `UPDATE: packages/agents/src/policy/modes.ts` - the two constants above `policyOf`.
- `UPDATE: packages/agents/src/index.ts:8` - export them beside `policyOf`.
- `UPDATE: packages/agents/src/policy/modes.test.ts` - the cases below.

## Steps

1. Tests first.
2. The order is `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk`.
3. The descriptions, from ahpd: "Asks before writing, going online or destroying anything." · "Writes inside the working directory without asking, and asks for other tools." · "Reads only: anything that writes or destroys is refused." · "Asks only when a tool says it is destructive." · "Runs every tool without asking." · "Refuses anything that would have needed approval, without asking."

## Validation

- `PERMISSION_MODES` has every `PermissionMode` once (a type test fails when a mode is added to the union and not to the list).
- Every mode has a description.
- `pnpm --filter @cofold/agents test` is clean.

## Resume

- **Built:** `PERMISSION_MODES` (the six, in the plan's order, `as const satisfies readonly PermissionMode[]`) and `PERMISSION_MODE_DESCRIPTIONS` (the six sentences, verbatim from ahpd's `PERMISSION_DESCRIPTIONS`) sit above `policyOf` in `policy/modes.ts` and are exported from `index.ts`.
- **Where the type test lives:** `src/types/contracts.test-d.ts`, not `modes.test.ts` (a `*.test-d.ts` is the project's place for a type assertion). It asserts `Exclude<PermissionMode, (typeof PERMISSION_MODES)[number]>` is `never` and that `PermissionMode` equals the list's union, so a mode added to the union and not to the list fails. Checked by shortening the list to five: both assertions fail under `tsc -p tsconfig.test.json` and under the root `vitest run --typecheck --project @cofold/agents`. Running `vitest --typecheck` inside the package directory does *not* report it (it picks a different config); the workspace runner does.
- **Validation:** `modes.test.ts` covers the order, no duplicates and a description per mode; 212 tests pass in `@cofold/agents`; `tsc -p tsconfig.test.json` is clean.
