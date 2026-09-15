<!--
Domain: commands
Status: Shipped
Priority: Medium
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: ../repo/01-workspace.md
Reference: ./00-commands.md
-->

# COMMANDS-01 - `@facio/commands` layout: contracts in `types/`, runtime beside them

_Status: Shipped 2026-09-16 · Priority: Medium · Created: 2026-09-16 · Built: 2026-09-16_

## Goal

Give `@facio/commands` the layout the agents packages already follow: `src/types/` holds contracts only, the runtime file of the same name sits beside it, and the `core/` folder (a name for a position that stopped existing when the package got its own name) is gone.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | `src/types/` holds every exported `interface` / `type` plus the private helpers only types use (`Always`); no `const`, `function` or `class`. Files are **by concept, not by runtime file**: `json-schema` (`JsonSchema`), `standard-schema` (Standard Schema interop), `coerce` (`Coercer`), `field` (`OptionSpec`, `ArgumentSpec`, `Field`, `CliField`, `OptionNote`, `CompletionContext`, `CompletionSource`, `FieldDescriptor`), `command` (`Command`, `CommandDefinition`, `ActionDefinition`, `CommandGroup`, `CommandSection`, `CommandExample`, `CommandMeta`, `Surface*`, `PatternToken`, `InputOf`, `ValueOf`), `input` (`RawCliInput`), `argv` (`Tokens`, `OptionTableEntry`, `Match`), `context`, `registry` (`ProviderDefinition`, `RegistryOptions`, `AuthorizeRequest`, `ExecuteOptions`, `Resolution`, `Runner`), `errors` (`FaultKind`), `compact` (`Compacted`). Runtime files keep their names at `src/<name>.ts` and import `./types/<concept>.js`; types files import each other by relative path; there is no `types/index.ts` barrel | CLAUDE.md rule for `src/types/`; user (2026-09-16): "CommandGroup, CommandSection are in registry.ts while we have a command.ts", "JsonSchema deserves its own type file" |
| 2 | `Error` subclasses stay in the runtime `errors.ts`; only `FaultKind` moves | A class is runtime |
| 3 | `CommandMeta` and `Surfaces` stay exported from the package index, because `@facio/mcp` and `@facio/remote` augment them with `declare module "@facio/commands"` | The augmentation merges with the exported declaration only |
| 4 | The inline `import("./context.js").CommandContext` / `.Output` in the `run` signatures become top-level `import type`; with contracts in their own files the cycle those inline imports avoided is type-only and harmless | User rule: never inline `import()` types |

## Done

- 2026-09-16: split and moved, then regrouped by concept (`field.ts`, `json-schema.ts`, `standard-schema.ts` created; `types/schema.ts` gone); index rewritten (`./types/<name>.js` for types, `./<name>.js` for runtime); two tests adjusted (`command.test.ts` inline `InputOf`, `schema.test.ts` index path); `docs/commands/07-mcp.md` links and `CLAUDE.md` layout updated. `pnpm check`: 41 files, 480 tests, no type errors, unchanged from before.
- Not added: a `contracts.test-d.ts` for the types tree (the agents package has one); the `InputOf` type test in `command.test.ts` covers the one conditional type. Add when a contract change needs a compile-time guard.
