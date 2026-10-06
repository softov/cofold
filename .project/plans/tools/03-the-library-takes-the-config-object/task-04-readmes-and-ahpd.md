---
title: The READMEs show the configuration object, and ahpd's adoption is planned
status: todo
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

