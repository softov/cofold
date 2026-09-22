---
title: Commands domain - current state
domain: commands
revalidated: 2026-09-16
---

# Commands domain - current state

The `commands` domain is the command framework: `@cofold/commands` (the declaration, the registry, input, argv grammar, coercion, schema) and its surfaces `@cofold/terminal`, `@cofold/mcp`, `@cofold/remote`, `@cofold/config`, `@cofold/yaml`, `@cofold/docs`; what they share (`JsonSchema`, the validator, Standard Schema) is `@cofold/sdk`.

## What exists today (2026-09-16)

- The framework is built (last published as `cofold@0.1.0`; `@cofold/*` not yet published); `docs/commands/01-11` document it; `examples/commands/*` are its five programs.
- Every package keeps its exported types in `src/types/`, grouped by concept (rule in `CLAUDE.md`).
- Its open items are in [`/ROADMAP.md`](../../../ROADMAP.md) (targets, authentication, `doctor`, built-in renames, object fields at a terminal, extended MCP, prompts, aliases) and stay there until one becomes a plan here.

## Plans

None open.

Next free number: `02`.
