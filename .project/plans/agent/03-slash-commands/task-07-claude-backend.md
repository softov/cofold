---
title: The Claude backend lists its own commands and nothing else
status: todo
depends: [task-04-service.md, task-06-shell-docs.md]
layer: papo
refs:
  - code://packages/papo/src/claude/chat.ts
  - code://packages/papo/src/chat-contract.test.ts
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273
---

## Objective

On the Claude backend `commands()` is `supportedCommands()`, `skills()` is empty (0.3.273 lists skills among the commands), `say('/compact')` runs the CLI's, the `autoCompact` special-casing is gone, and the contract test tells the same story on both backends.

## Files

- `UPDATE: packages/papo/src/claude/chat.ts` - `commands()` from `supportedCommands()`; `skills()` returns `[]`; delete `COMPACT_COMMAND`, `compact`, the `autoCompact` refusal (decision 13).
- `UPDATE: packages/papo/src/claude/chat.test.ts` - the models-and-commands test; the `autoCompact` assertion goes.
- `UPDATE: packages/papo/src/chat-contract.test.ts` - the `compact` scenario becomes `say('/compact')` (decision 14); a `commands` scenario.
- `UPDATE: .project/plans/cli/03-papo-claude/plan.md` - decisions 7 and 11 amended.

## Steps

1. Mechanical, per the files above.
2. Manual run: `papo --backend claude`, type `/`: Claude's list once; `/compact` runs the CLI's and the transcript shows its echo and `Compacted`.

## Validation

- `pnpm check`; the manual run.

## Resume

