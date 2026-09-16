---
title: The standard tools declare their subjects; papo's permission mode maps to decide()
status: todo
depends: [task-03-rules-and-subject.md]
layer: tools
refs:
  - code://packages/tools/src/shell.ts#L39-L52 - `shell_exec`, input `{ command, cwd?, timeoutMs? }`
  - code://packages/tools/src/files.ts#L46-L158 - `read_file`, `write_file`, `edit_file` (input `path`), `list_files`, `search_files` (input `pattern`)
  - code://packages/papo/src/agent.ts#L33-L39 - `policyOf(mode)` returning `requireApproval`
  - code://packages/papo/src/config.ts#L28 - `permissions: 'ask' | 'destructive' | 'auto'`
---

## Objective

Rules can name what `@facio/tools`' tools act on, and papo compiles and behaves as before on `decide()` ([117](../../../decisions/rules-are-harness-data.md), [116](../../../decisions/policy-decides-allow-ask-deny.md)).

## Files

- `UPDATE: packages/tools/src/shell.ts:39-52` - `subject: (input) => input.command`.
- `UPDATE: packages/tools/src/files.ts:46-158` - `subject: (input) => input.path` on `read_file`, `write_file`, `edit_file`; `subject: (input) => input.pattern` on `list_files`, `search_files`.
- `UPDATE: packages/tools/src/shell.test.ts`, `packages/tools/src/files.test.ts` - one assertion per tool that `tool.subject(input)` returns the field.
- `UPDATE: packages/papo/src/agent.ts:33-39` - `policyOf` on `decide`.
- `UPDATE: packages/papo/src/chat.test.ts` (the `permissions` scenarios) - unchanged expectations, re-run.
- `UPDATE: packages/tools/README.md`, `packages/papo/README.md` - one line each.

## Steps

1. `@facio/tools`: add `subject` next to `effects` on each tool named above; `memory_read` / `memory_write` / `web_fetch` / `web_search` declare none (name-only rules).

2. papo `policyOf`:

   ```ts
   export function policyOf(mode: PermissionMode): Partial<Policy> {
     switch (mode) {
       case 'ask': return { decide: () => ({ behavior: 'ask' }) };
       case 'auto': return { decide: () => ({ behavior: 'allow' }) };
       case 'destructive': return {};
     }
   }
   ```

   Rule lists in papo's config (`permissions.rules`) are a `cli` plan, not this task.

3. Tests: `chat.test.ts`'s permission scenarios (`read_file` answers, `shell_exec` asks under `destructive` and runs under `auto`) pass unchanged.

## Validation

- `pnpm check`.
- papo over `@facio/agents`: `permissions: ask` asks for `read_file`; `destructive` asks for `shell_exec` only; `auto` asks nothing (manual, or the existing `chat.test.ts` scenarios).

## Resume

