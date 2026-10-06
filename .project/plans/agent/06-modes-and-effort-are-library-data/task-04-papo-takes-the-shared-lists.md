---
title: papo takes the shared lists, and its effort reaches the request
status: done
depends: [task-01-the-permission-modes.md, task-02-the-thinking-levels.md, task-03-a-reasoning-param-turns-reasoning-on.md]
layer: "papo"
refs:
  - "[code://packages/papo/src/types/settings.ts#L4](../../../../packages/papo/src/types/settings.ts#L4) - `Reasoning`"
  - "[code://packages/papo/src/types/settings.ts#L23-L24](../../../../packages/papo/src/types/settings.ts#L23-L24) - `PERMISSION_MODES`, `REASONING_LEVELS`"
  - "[code://packages/papo/src/types/config.ts#L23](../../../../packages/papo/src/types/config.ts#L23) - papo's four-mode `PermissionMode`"
  - "[code://packages/papo/src/config.ts#L39](../../../../packages/papo/src/config.ts#L39) - the `permissions` enum"
  - "[code://packages/papo/src/config.ts#L45](../../../../packages/papo/src/config.ts#L45) - the `reasoning` enum"
  - "[code://packages/papo/src/commands.ts#L26](../../../../packages/papo/src/commands.ts#L26) - the `--reasoning` enum"
  - "[code://packages/papo/src/agent.ts#L64-L72](../../../../packages/papo/src/agent.ts#L64-L72) - `params.reasoning` from the setting"
---

## Objective

papo's mode list, level list and the enums that check them come from `@cofold/agents`, its four modes unchanged, and a chosen level is sent in the request.

## Files

- `UPDATE: packages/papo/src/types/settings.ts:4,23-24` - `Reasoning = EffortLevel`; `PERMISSION_MODES` is the shared list filtered to papo's four, in the shared order; `REASONING_LEVELS = EFFORT_LEVELS`.
- `UPDATE: packages/papo/src/config.ts:39,45` - the enums are `[...PERMISSION_MODES]` and `[...REASONING_LEVELS]`.
- `UPDATE: packages/papo/src/commands.ts:26` - the same for the option.
- `UPDATE: packages/papo/src/agent.ts:64-67` - `const effort = effortOf(settings.reasoning)`, and `reasoning: { effort }` only when it is defined.
- `UPDATE: packages/papo/src/chat.test.ts` (or `config.test.ts`) - the cases below.

## Steps

1. Tests first.
2. Replace the copies; papo's `PermissionMode` type stays its four.

## Validation

- A chat with `reasoning: 'high'` on the fake fetch of `openaiCompatProvider`: the request body has `reasoning`; fails first without task 03.
- `reasoning: 'off'`: no `reasoning` in the body.
- The config still refuses `permissions: 'plan'` and `reasoning: 'max'`.
- `pnpm --filter @cofold/papo test` and `pnpm typecheck` are clean.

## Resume

- **Built:** `types/settings.ts` writes `type Reasoning = EffortLevel`, takes `REASONING_LEVELS = EFFORT_LEVELS`, and derives `PERMISSION_MODES` from the harness's list with `HARNESS_PERMISSION_MODES.filter((mode): mode is PermissionMode => OFFERED_MODES.has(mode))`, where `OFFERED_MODES` is the four papo offers. Filtering the shared list by name rather than cutting at `plan` and `auto` means a mode the harness adds later does not leak into papo's choices on its own, and papo's `PermissionMode` type stays the four. `config.ts` and `commands.ts` build their enums with `[...PERMISSION_MODES]` and `[...REASONING_LEVELS]`. `agent.ts` sets `const effort = effortOf(settings.reasoning)` and spreads `reasoning: { effort }` only when it is defined.
- **Validation:** a new `chat.test.ts` case drives the real `openaiCompatProvider` over a stub fetch answering server-sent events, and asserts `reasoning_effort: 'high'` in the posted body, then no `reasoning` or `reasoning_effort` after `reasoning: 'off'`. Reverting task 03's adapter expression and rebuilding fails exactly that case, so it is the end-to-end proof the plan asked for. `config.test.ts` gains the refusals: `permissions: 'plan'` and `permissions: 'auto'` (harness modes papo does not offer) and `reasoning: 'max'` (a provider value, not a level) all fail with the key named.
- **Checks:** `pnpm --filter @cofold/papo test` 141 pass; `pnpm typecheck` clean.

