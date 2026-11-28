---
title: The docs and the versions
status: todo
depends: [task-02-the-transport-sends-multipart.md, task-03-the-reader-imports-multipart.md, task-04-a-file-needs-an-opt-in.md]
layer: "docs"
refs:
  - "[code://docs/commands/03-validation.md](../../../../docs/commands/03-validation.md) - the coercers, where `file` goes"
  - "[code://docs/commands/09-remote.md#L66-L95](../../../../docs/commands/09-remote.md#L66-L95) - *OpenAPI* and *Form bodies and authentication*"
  - "[code://docs/commands/07-mcp.md#L13-L71](../../../../docs/commands/07-mcp.md#L13-L71) - *Tool adapter* and *Serve over stdio*, where `allowFiles` goes"
  - "[code://packages/commands/package.json](../../../../packages/commands/package.json) - the version, chosen at release"
  - "[code://packages/remote/package.json](../../../../packages/remote/package.json) - the version, chosen at release"
  - "[code://packages/mcp/package.json](../../../../packages/mcp/package.json) - the version, chosen at release"
---

## Objective

The docs and the package READMEs say how a command uploads a file.
They say what `allowFiles` lets an agent do, and that a file command is not an HTTP route.
The three packages have versions chosen when this ships.

## Files

- `UPDATE: docs/commands/03-validation.md` - `coerce.file`, and that the transport checks the file.
- `UPDATE: docs/commands/09-remote.md:66-95` - multipart bodies, `files`, `maxFileBytes`, the body type order and the `contentType` hint.
- `UPDATE: docs/commands/07-mcp.md:13-71` - `allowFiles`, and what an agent can read with it.
- `UPDATE: packages/commands/README.md` - one line on `coerce.file`.
- `UPDATE: packages/remote/README.md` - one paragraph on uploads.
- `UPDATE: packages/mcp/README.md` - one line on `allowFiles`.
- `UPDATE: packages/commands/package.json` - the version, chosen when this ships.
- `UPDATE: packages/remote/package.json` - the version, chosen when this ships.
- `UPDATE: packages/mcp/package.json` - the version, chosen when this ships.

## Steps

1. Write the docs from the code as built, not from this plan.
2. Say in `07-mcp.md` that `allowFiles` lets an agent upload any file that the user can read.
3. Bump the versions chosen at release, and push no tag.

## Validation

- Every code sample in the changed pages matches a test or an example that runs.
- `pnpm check` is clean.

## Resume
