---
title: The docs and the versions
status: todo
depends: [task-02-the-reference-names-the-effect.md, task-04-an-openapi-operation-declares-its-effect.md, task-07-petshop-declares-its-pets.md]
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

- `UPDATE: docs/commands/02-actions.md` - a section on `effect` and `resource`, with the four roles (list, get, create, item) as they follow from effect and key.
- `UPDATE: docs/commands/07-mcp.md` - the derived hints and that `meta.mcp.annotations` wins.
- `UPDATE: docs/commands/09-remote.md` - the manifest fields, and `effect` and `resource` in `x-cli`.
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
