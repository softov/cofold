---
title: An action declares what it does to what - implemented
date: 2026-10-06
refs:
  - git://16d3264
  - npm://@cofold/commands@0.3.0 - the release that carries it, with mcp 0.3.0, remote 0.5.0, terminal 0.3.0 and config 0.3.1
  - "[code://packages/commands/src/types/command.ts](../../../../packages/commands/src/types/command.ts) - `Effect`, `Resource`, and the fields on both definitions"
  - "[code://packages/remote/src/serve.ts](../../../../packages/remote/src/serve.ts) - `checkPath`, called from `routesOf`"
---

An action can say what it does (`read`, `add`, `change`, `remove`) and to which kind of thing, keyed by one of its inputs.
The manifest and OpenAPI carry both, MCP derives its hints from the effect, the terminal asks before a `remove`, and `serve` refuses at start a route whose path parameter is not a required, single input.

## What was built

- [`code://packages/commands/src/types/command.ts`](../../../../packages/commands/src/types/command.ts) - `Effect`, `Resource`, `effect?` and `resource?`.
- [`code://packages/commands/src/registry.ts`](../../../../packages/commands/src/registry.ts) - registration refuses an unknown effect, an empty kind, and a key that is not an input field.
- [`code://packages/commands/src/docs.ts`](../../../../packages/commands/src/docs.ts) - the reference's `Effect` and `Resource` line.
- [`code://packages/remote/src/manifest.ts`](../../../../packages/remote/src/manifest.ts) and [`code://packages/remote/src/openapi.ts`](../../../../packages/remote/src/openapi.ts) - both fields out and back, and in `x-cli`.
- [`code://packages/remote/src/serve.ts`](../../../../packages/remote/src/serve.ts) - `checkPath`.
- [`code://packages/mcp/src/index.ts`](../../../../packages/mcp/src/index.ts) - `annotationsFor`; written annotations win key by key.
- [`code://packages/terminal/src/program.ts`](../../../../packages/terminal/src/program.ts) - the question before a `remove`, `--yes`, and `confirm` on `Program`.
- [`code://examples/commands/petshop/cli.ts`](../../../../examples/commands/petshop/cli.ts) - every pet action declares both, and `pet remove`.
- The four READMEs and `docs/commands/01`, `02`, `07` and `09`.

## Verified

- `pnpm check` clean: 71 files and 886 tests; the CI run on GitHub for 16d3264 green on both jobs.
- 2026-10-06: petshop served the way ahpd serves (`serve()` under `/api`, a bearer token), a CLI built by `commandsFrom` over its manifest, and ahpd-web pointed at it. The manifest carried both fields, a remote `pet remove` asked first and took `--yes`, and ahpd-web listed, created, showed and removed pets.
- ahpd's served registry handed to the new `serve()` is refused on `usage.list`, as task 09 intends.

## Departures from the plan

- petshop's new pet id was the count plus one, which `pet remove` made reuse a live id; it is now the highest id plus one, with a test.

## Left for later

- ahpd declaring effects on its commands and splitting `usage` and `plugin config`: ahpd plan daemon 16.
