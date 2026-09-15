# Commands domain - current state

The `commands` domain is the command framework: `@facio/commands` (the declaration, the registry, input, argv grammar, coercion, schema) and its surfaces `@facio/terminal`, `@facio/mcp`, `@facio/remote`, `@facio/config`, `@facio/yaml`, `@facio/docs` (REPO-01 Task 3 creates them from `packages/facio`).

## What exists today (2026-09-16)

- The framework is built and published as `facio@0.1.0`; `docs/commands/01-11` document it; `examples/commands/*` are its five programs.
- Its open items are in [`/ROADMAP.md`](../../../ROADMAP.md) (targets, authentication, `doctor`, built-in renames, object fields at a terminal, extended MCP, prompts, aliases) and stay there until one becomes a plan here.

## Plans

| Plan | Objective |
| --- | --- |
| [01-commands-layout.md](01-commands-layout.md) | Contracts in `src/types/`, runtime beside them; `core/` removed (Shipped) |

Next free number: `02`.
