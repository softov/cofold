---
title: The claude backend follows trust, and the docs say what loads
status: todo
depends: [task-03-trust-decides-what-loads.md]
layer: "copapo, docs"
refs:
  - "[code://packages/copapo/src/claude/chat.ts#L156](../../../../packages/copapo/src/claude/chat.ts#L156) - `settingSources`, which loses `project` in an untrusted folder"
  - "[code://packages/copapo/README.md](../../../../packages/copapo/README.md) - the docs this task extends"
---

## Objective

In a folder copapo does not trust, the claude backend starts the CLI with `settingSources: ['user']`.
The README says which files copapo loads, in which order, and what trust gates.

## Files

- `UPDATE: packages/copapo/src/claude/chat.ts:156` - `settingSources` is `['user', 'project']` when trusted, else `['user']`.
- `UPDATE: packages/copapo/src/claude/chat.test.ts` - the two cases.
- `UPDATE: packages/copapo/README.md` - a section on context files, skills and trust: the folders, the order, the gated files, `copapo trust`, `/trust`, `projectTrust`, and that context files load without trust.
- `UPDATE: packages/store-file/README.md` - `readContextFiles` and the new `fileSkillSource` options.

## Steps

1. Pass the service's trust to `createClaudeChat`, and build `settingSources` from it.
2. Write the README section as a table of what loads, then the trust rules.
3. Say that a cloned repository's `AGENTS.md` reaches the model without trust, as in pi and Claude Code.
4. Run `lint-prose` on the plan files this task changes.

## Validation

- `packages/copapo/src/claude/chat.test.ts`: `settingSources` in both cases.
- `pnpm --filter @cofold/copapo typecheck` passes.

## Resume

