---
title: sessionUsage in the harness; Chat.usage; papo usage; /chat.usage replaces /chat.cost
status: done
depends: []
layer: agents, papo
refs:
  - code://packages/agents/src/model/usage.ts - `addUsage`, `ZERO_USAGE`
  - code://packages/agents/src/types/store.ts#L40-L58 - `RunRecord`; `StepRecord.kind === 'tool'` is a tool call
  - code://packages/papo/src/chat.ts - the harness backend's `Chat`
  - code://packages/papo/src/claude/chat.ts - the Claude backend's `Chat`, whose turns carry `usage` and `steps`
  - code://packages/papo/src/commands.ts#L336-L350 - a `talk` action's shape (`compact`)
  - code://packages/papo/src/screen/app.tsx#L532-L539,L615-L637 - `chat.cost`, `costLines`, `total`
---

## Objective

What a session used, from the harness's own records, with no prices: per run and in total (user, 2026-09-18: "a /usage without the costs... handled inside the agent harness, without external dependency, things already present, as the usage of the session").

## Files

- `NEW: packages/agents/src/types/usage.ts` - `RunUsage { runId, status, usage, steps, toolCalls, denials }`, `SessionUsage { runs: RunUsage[], usage, steps, toolCalls, denials }`.
- `NEW: packages/agents/src/store/usage.ts` - `sessionUsage({ store, sessionId })`; `NEW: usage.test.ts`.
- `UPDATE: packages/agents/src/index.ts`, `README.md`.
- `UPDATE: packages/papo/src/types/chat.ts` - `Chat.usage(sessionId): Promise<SessionUsage>`.
- `UPDATE: packages/papo/src/chat.ts`, `claude/chat.ts` - the two implementations.
- `UPDATE: packages/papo/src/commands.ts` - `usage <session>` (`talk`, `mcp: true`), `renderUsage`.
- `UPDATE: packages/papo/src/screen/app.tsx` - `chat.usage` in place of `chat.cost`; `usageLines` from `chat.usage`; `statusLines` tokens from the same.
- `UPDATE: packages/papo/README.md`; tests.

## Steps

1. `sessionUsage`: `runs.list` oldest first; per run `listSteps` and count `kind === 'tool'`; sums with `addUsage`.
2. `Chat.usage` on both backends; the Claude backend sums its turns (tool calls are the turn's tool parts).
3. Shell action and screen panel; the `Cost` panel and its command go.

## Validation

`pnpm check`.

## Resume

Done 2026-09-18; see implemented.md.
