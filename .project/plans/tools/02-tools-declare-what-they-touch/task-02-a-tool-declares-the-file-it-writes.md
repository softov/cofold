---
title: A tool declares the file it writes
status: todo
depends: []
layer: "agents, tools"
refs:
  - "[code://packages/agents/src/types/tool.ts#L36-L40](../../../../packages/agents/src/types/tool.ts#L36-L40) - `subject`, the slot `writes` sits beside"
  - "[code://packages/agents/src/tool/create-tool.ts#L22-L27](../../../../packages/agents/src/tool/create-tool.ts#L22-L27) - `createTool` spreads the definition, so `writes` passes through"
  - "[code://packages/agents/src/policy/modes.ts#L41-L49](../../../../packages/agents/src/policy/modes.ts#L41-L49) - `acceptEdits`"
  - "[code://packages/agents/src/types/policy.ts#L35-L40](../../../../packages/agents/src/types/policy.ts#L35-L40) - `PermissionModeRules`"
  - "[code://packages/tools/src/files.ts#L83-L132](../../../../packages/tools/src/files.ts#L83-L132) - `write_file`, `edit_file`; `at(path)` is the resolved absolute path"
  - "[code://packages/tools/src/memory.ts#L61-L77](../../../../packages/tools/src/memory.ts#L61-L77) - `memory_write`; `inside(path)` resolves and refuses outside the folder"
---

## Objective

`ToolDefinition` has `writes?(input): string`, the absolute path a call writes; `write_file`, `edit_file` and `memory_write` declare it; and `policyOf`'s `acceptEdits` treats a tool with `writes` as an edit and checks that path, unless the host passes its own `isEdit`.

## Files

- `UPDATE: packages/agents/src/types/tool.ts:31-47` - `writes?(input: Input): string`, with the doc comment from the plan.
- `UPDATE: packages/agents/src/types/policy.ts:35-40` - `isEdit?` optional; its comment names the default.
- `UPDATE: packages/agents/src/policy/modes.ts:41-49` - `acceptEdits`: `const isEdit = rules.isEdit ?? ((tool) => tool.writes !== undefined)`; the path is `args.tool.writes?.(args.input)` when the tool has it, else `input.path`.
- `UPDATE: packages/tools/src/files.ts:83-132` - `writes: (input) => at(input.path)` on `write_file` and `edit_file`.
- `UPDATE: packages/tools/src/memory.ts:61-77` - `writes: (input) => resolveWithin(dir, input.path).absolute` on `memory_write`.
- `UPDATE: packages/agents/src/policy/modes.test.ts`, `packages/tools/src/files.test.ts`, `packages/tools/src/memory.test.ts` - the cases below.

## Steps

1. Tests first.
2. Add the slot and the three declarations.
3. Change `acceptEdits`; the other modes do not read `writes`.

## Validation

- `write_file.writes({ path: 'src/a.ts', content: '' })` is `<workspace>/src/a.ts`; `shell_exec` has no `writes`.
- `policyOf('acceptEdits', { inside })` with no `isEdit`: `edit_file` inside the workspace is allowed, outside asks; `memory_write` asks (its file is outside the workspace); `shell_exec` asks.
- `policyOf('acceptEdits', { inside, isEdit })` with a host `isEdit` behaves as today.
- `pnpm --filter @cofold/agents test`, `pnpm --filter @cofold/tools test` and `pnpm typecheck` are clean.

## Resume

