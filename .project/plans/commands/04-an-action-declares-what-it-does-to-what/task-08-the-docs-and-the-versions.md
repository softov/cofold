---
title: The docs and the versions
status: done
depends: [task-02-the-reference-names-the-effect.md, task-04-an-openapi-operation-declares-its-effect.md, task-07-petshop-declares-its-pets.md, task-09-a-path-parameter-is-a-required-input.md]
layer: "docs"
refs:
  - "[code://docs/commands/02-actions.md#L134](../../../../docs/commands/02-actions.md#L134) - *Surfaces, and meta*, where `effect` and `resource` are explained"
  - "[code://docs/commands/07-mcp.md#L86](../../../../docs/commands/07-mcp.md#L86) - *Tool names and results*, which shows hand-written annotations"
  - "[code://docs/commands/09-remote.md#L54](../../../../docs/commands/09-remote.md#L54) - *OpenAPI*, where `x-cli` is documented"
  - "[code://packages/commands/package.json](../../../../packages/commands/package.json) - the version, chosen at release"
  - "[code://packages/remote/package.json](../../../../packages/remote/package.json) - the version, chosen at release"
  - "[code://packages/mcp/package.json](../../../../packages/mcp/package.json) - the version, chosen at release"
  - "[code://packages/terminal/package.json](../../../../packages/terminal/package.json) - the version, chosen at release"
---

## Objective

The docs and each package README say what `effect` and `resource` mean and what each surface does with them, and the four packages are bumped to versions chosen when it ships.

## Files

- `UPDATE: docs/commands/02-actions.md` - a section on `effect` and `resource`, with the four roles (list, get, create, item) as they follow from effect and key; any other combination is a plain action; a key over a list field is filled with a one-item list.
- `UPDATE: docs/commands/07-mcp.md` - the derived hints and that `meta.mcp.annotations` wins.
- `UPDATE: docs/commands/09-remote.md` - the manifest fields, `effect` and `resource` in `x-cli`, and that a path parameter must be a required, single-valued input or `serve` refuses it.
- `UPDATE: docs/commands/01-getting-started.md` - `--yes` beside the other standard globals, and the question before a `remove`.
- `UPDATE: packages/{commands,remote,mcp,terminal}/README.md` - one paragraph each.
- `UPDATE: packages/{commands,remote,mcp,terminal}/package.json` - the versions, chosen when this ships.

## Steps

1. Write the docs from the code as built, not from this plan.
2. Bump the versions chosen at release; no tag.

## Validation

- Docs have no failing test; every code sample in the changed pages matches a declaration petshop or a test actually runs.
- `pnpm check` is clean.

## Resume

Docs built 2026-10-06, awaiting review: `02-actions.md` (*What it does, to what*), `07-mcp.md` (*Hints from the effect*), `09-remote.md` (*Effect and resource*, and `x-cli` under *OpenAPI*), `01-getting-started.md` (`--yes`), and one paragraph in each of the four package READMEs. The versions are not bumped: they are chosen at release, as the plan says.

Versions chosen 2026-10-06 by Softov (minor bumps): commands 0.3.0, mcp 0.3.0, remote 0.5.0, terminal 0.3.0, and config 0.3.1 with no code change, so its range moves to `@cofold/commands` ^0.3.0.
