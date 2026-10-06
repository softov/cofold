---
title: A path parameter is a required input
status: implemented
depends: []
layer: "remote"
refs:
  - "[code://packages/remote/src/serve.ts#L83-L91](../../../../packages/remote/src/serve.ts#L83-L91) - `serve`, where `routesOf` is built once, when a program mounts its API"
  - "[code://packages/remote/src/serve.ts#L144-L150](../../../../packages/remote/src/serve.ts#L144-L150) - `routesOf`, every command with a binding"
  - "[code://packages/remote/src/serve.ts#L153-L170](../../../../packages/remote/src/serve.ts#L153-L170) - `match`, which needs one segment per path parameter, so a route with an absent parameter never matches"
  - "[code://packages/commands/src/input.ts#L41](../../../../packages/commands/src/input.ts#L41) - `fieldsOf`, the canonical input fields and whether each is required"
  - "[code://packages/remote/src/serve.test.ts](../../../../packages/remote/src/serve.test.ts) - the serve cases"
  - "file:///github/ahpd/packages/server/src/commands/usage.ts - `usage.list`: `:pool?` bound to `/usage/{pool}`, so `GET /usage` is a 404"
---

## Objective

`serve` refuses, when it is called, a command whose binding path names a `{param}` that is not a required, single-valued input field, naming the command id, the parameter and the path.
A program that mounts such an API fails at startup instead of serving a route that can never match.

## Files

- `UPDATE: packages/remote/src/serve.ts:144-150` - `routesOf` checks each binding's path parameters against the command's input fields.
- `UPDATE: packages/remote/src/serve.test.ts` - the cases below.

## Steps

1. Tests first.
2. For each `{name}` in `binding.path`: no input field called `name` throws `${id} binds {${name}} in ${path}, which is not an input field`; an optional field throws `${id} binds {${name}} in ${path}, but ${name} is optional`; a list (variadic slot or repeatable option) throws `${id} binds {${name}} in ${path}, but ${name} takes a list`.

## Validation

- `serve` over a command with pattern `usage :pool?` and path `/usage/{pool}` throws naming `usage.list`, `pool` and the path; fails first.
- A path naming a field that does not exist, and one naming a variadic slot, are each refused.
- A required slot in the path, and a required option in the path, serve as today; the existing serve tests pass unchanged.
- `pnpm --filter @cofold/remote test` is clean.

## Resume

Built 2026-10-06, awaiting review. `checkPath` in `serve.ts`, called from `routesOf`. Tests: four cases in `serve.test.ts`. ahpd's `usage.list` is refused by this once ahpd takes the new `@cofold/remote`.
