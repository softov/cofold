---
title: petshop declares its pets
status: implemented
depends: [task-03-the-manifest-carries-the-effect.md, task-05-mcp-hints-follow-the-effect.md, task-06-the-terminal-asks-before-a-remove.md]
layer: "examples"
refs:
  - "[code://examples/commands/petshop/cli.ts#L33-L47](../../../../examples/commands/petshop/cli.ts#L33-L47) - the `pets` capability, which gains `remove`"
  - "[code://examples/commands/petshop/cli.ts#L49-L132](../../../../examples/commands/petshop/cli.ts#L49-L132) - `pet.list`, `pet.add`, `pet.show`"
  - "[code://examples/commands/petshop/action.test.ts](../../../../examples/commands/petshop/action.test.ts) - the example's own tests"
---

## Objective

petshop is the worked case: `pet.list` is `read` of `pet`, `pet.add` is `add` of `pet`, `pet.show` is `read` of `pet` by `id`, and a new `pet.remove` (`pet remove :id`, `DELETE /pets/{id}`, `mcp: true`) is `remove` of `pet` by `id`.

## Files

- `UPDATE: examples/commands/petshop/cli.ts` - the fields on the three actions; `remove(id)` on the capability; the `pet.remove` action.
- `UPDATE: examples/commands/petshop/action.test.ts` - the cases below.

## Steps

1. Tests first.
2. Declare the fields and add `pet.remove`.

## Validation

- The manifest lists `pet.list`, `pet.add`, `pet.show` and `pet.remove` with the effect and resource above; fails first.
- The MCP tool list shows `readOnlyHint: true` on `pet_list` and `pet_show`, and `destructiveHint: true` on `pet_remove`.
- Every row `pet list --json` returns has an `id`, the resource key.
- `pnpm examples` and `pnpm test` are clean; `petshop pet remove 1` asks when run by hand in a terminal.

## Resume

Built 2026-10-06, awaiting review. The `pets` capability gained `remove`. The existing case pinning the published ids now includes `pet.remove`. Tests: three cases in `action.test.ts`.
