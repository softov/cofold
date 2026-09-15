# Commands domain - current state

The `commands` domain is the command framework: `@facio/commands` (the declaration, the registry, input, argv grammar, coercion, schema) and its surfaces `@facio/terminal`, `@facio/mcp`, `@facio/remote`, `@facio/config`, `@facio/yaml`, `@facio/docs`; what they share (`JsonSchema`, the validator, Standard Schema) is `@facio/sdk`.

## What exists today (2026-09-16)

- The framework is built (last published as `facio@0.1.0`; `@facio/*` not yet published); `docs/commands/01-11` document it; `examples/commands/*` are its five programs.
- Every package keeps its exported types in `src/types/`, grouped by concept (rule in `CLAUDE.md`).
- Its open items are in [`/ROADMAP.md`](../../../ROADMAP.md) (targets, authentication, `doctor`, built-in renames, object fields at a terminal, extended MCP, prompts, aliases) and stay there until one becomes a plan here.

## Plans

None open.

Next free number: `02`.
