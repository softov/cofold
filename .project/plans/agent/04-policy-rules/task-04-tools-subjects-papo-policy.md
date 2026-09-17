---
title: The standard tools declare their subjects; papo's permission mode maps to decide()
status: done
depends: [task-03-rules-and-subject.md]
layer: tools
refs:
  - code://packages/tools/src/shell.ts#L39-L52 - `shell_exec`, input `{ command, cwd?, timeoutMs? }`
  - code://packages/tools/src/files.ts#L46-L158 - `read_file`, `write_file`, `edit_file` (input `path`), `list_files`, `search_files` (input `pattern`)
  - code://packages/papo/src/agent.ts#L33-L39 - `policyOf(mode)` returning `requireApproval`
  - code://packages/papo/src/config.ts#L28 - `permissions: 'ask' | 'destructive' | 'auto'`
---

## Objective

Rules can name what `@facio/tools`' tools act on, and papo compiles and behaves as before on `decide()` ([117](../../../decisions/rules-are-harness-data.md); `decide()` per cli/03 F3).

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

   This `policyOf` keeps papo's three modes compiling; cli/04 task 04 replaces them with Claude's four (cli/03 F8) and adds the rule lists. Not this task.

3. Tests: `chat.test.ts`'s permission scenarios (`read_file` answers, `shell_exec` asks under `destructive` and runs under `auto`) pass unchanged.

## Validation

- `pnpm check`.
- papo over `@facio/agents`: `permissions: ask` asks for `read_file`; `destructive` asks for `shell_exec` only; `auto` asks nothing (manual, or the existing `chat.test.ts` scenarios).

## Resume

- **Done (2026-09-16):** `subject` next to `effects` on `shell_exec` (the `command`), `read_file`, `write_file`, `edit_file` (the `path`), `list_files`, `search_files` (the `pattern`); the memory and web tools declare none. One `subject` assertion per tool in `files.test.ts` and `shell.test.ts`. papo's `policyOf` on `decide` was already moved in task 01 (same code as step 2 here, with the comment that cli/04 task 04 replaces the three modes). READMEs: `@facio/tools` names the subjects (files paragraph and the `shell()` section), `@facio/papo` says each mode is one `decide` answer and rule lists are not in its configuration yet.
- **Evidence:** `pnpm --filter @facio/tools typecheck` clean; `files.test.ts` 8 tests, `shell.test.ts` 6 tests green; papo `chat.test.ts` 13 tests green unchanged (`read_file` answers, `shell_exec` asks under `destructive` and runs under `auto`; `auto` runs a destructive tool without asking and `ask` asks for everything). `@facio/agents` and `@facio/papo` `tsc` report errors only in `src/testing/fake-model.ts` and `src/claude/chat.ts`, other sessions' in-progress edits; the dist still emits (no `noEmitOnError`), so the cross-package tests ran against the new types.
- **Deviations:** none beyond the task 01 pull of `policyOf`.
- **Found:** nothing the plan did not know.


