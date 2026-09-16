---
title: Contracts
status: todo
depends: []
layer: agents
---

## Objective

Contracts.

## Files

- `UPDATE: packages/agents/src/types/command.ts`, `types/hooks.ts`, `types/model.ts`, `types/outcome.ts`, `types/event.ts`, `types/contracts.test-d.ts`, `errors.ts`, `UPDATE: packages/agents/src/index.ts` (export `ReasoningEffort`).

## Steps

- `command.ts`:
  ```ts
  | { type: 'steer'; text: string }
  ```
- `hooks.ts`:
  ```ts
  export type BeforeToolResult =
    | { decision: 'allow' }
    | { decision: 'modify'; input: unknown }
    | { decision: 'deny'; reason: string }
    | { decision: 'approval'; prompt?: string }
    /** Ends the run after this call is answered "Not executed" (decision 97). */
    | { decision: 'stop'; reason: string };
  export type AfterToolResult = { output: ToolOutput; isError?: boolean; /** Ends the run after this result is recorded (decision 97). */ stop?: { reason: string } };
  ```
- `model.ts`:
  ```ts
  export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoning?: { effort?: ReasoningEffort; maxTokens?: number };
  export interface ModelRequest { instructions; messages; tools; params; /** Stable per session; adapters that key a prompt cache use it (decision 100). */ cacheKey: string; signal }
  ```
- `outcome.ts`: `export type StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy' | 'hook';`
- `event.ts`: `| { type: 'run.steered'; message: Message }` after `run.started`.
- `errors.ts`: `| 'not_running'`.
- `contracts.test-d.ts`: a `BeforeToolResult` of `{ decision: 'stop' }` without `reason` fails; `ModelRequest` without `cacheKey` fails; `RunCommand` `steer` without `text` fails.

## Validation

- `pnpm check` (the loop and the adapter fail typecheck until Tasks 2-4; do Tasks 1-4 in one branch).

## Resume

(decisions 95-101)
