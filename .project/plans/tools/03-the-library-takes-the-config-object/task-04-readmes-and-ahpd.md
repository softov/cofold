---
title: The READMEs show the configuration object, and ahpd's adoption is planned
status: done
depends: [task-01-the-providers-configuration.md, task-02-standard-capabilities.md]
layer: "docs; ahpd after a cofold release"
refs:
  - "[code://packages/model-openai-compat/README.md](../../../../packages/model-openai-compat/README.md) - where the providers configuration is documented"
  - "[code://packages/tools/README.md](../../../../packages/tools/README.md) - where `standardCapabilities` is documented"
  - file:///github/ahpd/packages/agent-cofold/src/config.ts - lines 21-43 and 116-129, the interfaces and `splitModel` that go; `harnessConfigPath` and `harnessConfig` stay
  - file:///github/ahpd/packages/agent-cofold/src/capabilities.ts - lines 30-118, replaced by `standardCapabilities` and, with tools/02, `Capability.exclude`
---

## Objective

Each README shows a program passing the object it read; an ahpd plan, opened after the cofold release, replaces ahpd's copies and keeps its own file reader.

## Files

- `UPDATE: packages/model-openai-compat/README.md` - `ProviderConfig`, `PROVIDER_SCHEMA`, `providersOf`, `splitModel`, `providerFor`, one example.
- `UPDATE: packages/tools/README.md` - `ToolsConfig`, `TOOLS_SCHEMA`, `standardCapabilities`, one example; that the file and the memory folder are the program's to choose.
- `UPDATE: ahpd packages/agent-cofold/src/config.ts, capabilities.ts` - in an ahpd plan, not here; ahpd passes `memoryDir: join(storeRoot, 'memory', workspaceSlug({ workspace }))` itself, and no `memoryDir` when the store is in memory.

## Steps

1. Write the README changes.
2. After the cofold release, open the ahpd plan and put its path in *Resume*.

## Validation

- Each README example compiles against the exports.
- The ahpd plan names this task and the cofold versions it needs.

## Resume

- **Built:** `packages/model-openai-compat/README.md` gains a `## Configuration` section between *Catalog* and *Options*: one example in which a program parses its own file, validates `providers` against `PROVIDER_SCHEMA`, builds the map with `providersOf`, picks one with `providerFor` and asks `splitModel` whether the reference is one at all, followed by a five-row table for `ProviderConfig`, `PROVIDER_SCHEMA`, `providersOf`, `splitModel` and `providerFor` (the last throwing `AgentError('invalid_options')`). `packages/tools/README.md` gains a `## standardCapabilities(config, { workspace, memoryDir? })` section after *Use*: the same shape of example, a four-row table for the `files` / `shell` / `web` / `memory` keys (absent is on, `false` off, `web: { search }` adds `web_search` in key order, memory only with a `memoryDir`), and the sentence that the file's path, its environment variables and the memory folder are the program's to choose - papo's being `<home>/memory/<workspace slug>`, as the `memory()` section below already says.
- **Validation:** both examples compile against the exports. Checked by writing a temporary `readme-check.ts` into each package's `src` holding the example verbatim (with `text`, `workspace`, `home`, `slug` and `join` declared) and running `pnpm --filter @cofold/model-openai-compat typecheck` and `pnpm --filter @cofold/tools typecheck`; both were clean, and the two files were removed afterwards. The check files import the package's own entry module (`./index.js` from inside `src`), which is the same export surface the README names by package.
- **Not run:** the second validation, "the ahpd plan names this task and the cofold versions it needs". ahpd is outside this worktree and its plan is opened after a cofold release (step 2), so it is written up in `deferred.md` instead.
- **Departure:** none.
