---
title: Steering in the loop
status: todo
depends: [task-01-contracts.md]
layer: agents
---

## Objective

Steering in the loop.

## Files

- `CREATE: packages/agents/src/run/steering.ts`, `UPDATE: run/handle.ts`, `run/run.ts`, `run/resume.ts`, `run/turn.ts`, `CREATE: packages/agents/src/run/steering.test.ts`.

## Steps

- `steering.ts`:
  ```ts
  export interface Steer { text: string; resolve: () => void; reject: (e: Error) => void }
  export type SteerQueue = Steer[];
  export function enqueueSteer(queue: SteerQueue, text: string): Promise<void> {
    return new Promise((resolve, reject) => queue.push({ text, resolve, reject }));
  }
  /** Appends every queued steer to the transcript, emits run.steered per message, resolves the submitters (decisions 95-96). */
  export async function drainSteering(ctx: TurnContext): Promise<void> {
    const pending = ctx.steering.splice(0);
    if (pending.length === 0) return;
    const messages: Message[] = pending.map((s) => ({ id: newId(), role: 'user', source: 'input', parts: [{ type: 'text', text: s.text }], createdAt: now() }));
    await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages });
    for (const message of messages) await ctx.emit({ type: 'run.steered', message });
    for (const s of pending) s.resolve();
  }
  export function rejectSteering(queue: SteerQueue, runId: string): void {
    for (const s of queue.splice(0)) s.reject(new AgentError({ code: 'not_running', message: `run ${runId} finished before the message was delivered` }));
  }
  ```
- `handle.ts`: `createRunHandle` takes `steer: (text: string) => Promise<void>`; `submit`:
  ```ts
  if (command.type === 'steer') {
    if (closed) throw new AgentError({ code: 'not_running', message: `run ${args.runId} is not running` });
    return args.steer(command.text);
  }
  ```
  before the `onCommand` branch. `finish` unchanged (rejection happens in `settle`, which owns the queue through `ctx`).
- `run.ts:22-32`: `const steering: SteerQueue = [];` before `createRunHandle({ runId, sessionId, abort, steer: (text) => enqueueSteer(steering, text) })`; `setupRun` passes `steering` into `createTurnContext`. `TurnContext` gains `steering: SteerQueue`.
- `resume.ts:30-47`: same queue and `steer` on the handle; `validateCommand` first line: `if (command.type === 'steer') throw new AgentError({ code: 'invalid_options', message: 'steer needs a live handle; answer the pending request first' });` (the `Command` type in `resume.ts` becomes `Exclude<RunCommand, { type: 'cancel' | 'steer' }>` and `onCommand` narrows before `accept`).
- `turn.ts`: in `runTurn`'s loop, after the abort check and before the `maxSteps` check: `await drainSteering(ctx);`. In `settle`: `rejectSteering(ctx.steering, ctx.runId)` before `ctx.handle.finish(outcome)`. Also in `finishDetached` paths of `resume.ts` (no ctx there; the queue is in scope).
- `steering.test.ts` (memory store, fake model that calls a tool once then answers): (1) `submit(steer)` while the tool executes → resolves; the transcript is `user, assistant(toolCall), tool, user(steer), assistant`; `run.steered` appears between `tool.completed` and the second `model.started`. (2) Two steers before the drain → two messages, both promises resolve, order preserved. (3) steer after `run.finished` → throws `not_running`. (4) steer queued while the last model step is in flight and the reply has no tool calls → rejected `not_running`, transcript unchanged. (5) `resume({ command: { type: 'steer' } })` → handle finishes `failed { code: 'invalid_options' }` with no store writes (same shape as decision 92). (6) A resumed run accepts a steer after the approval is applied.

## Validation

- `pnpm check`; `examples/` gain `examples/agents/steer.ts` (send, steer after the first `tool.started`, print the transcript order).

## Resume


