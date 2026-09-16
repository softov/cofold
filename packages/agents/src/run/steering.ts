import type { Message } from '../types/message.js';
import type { SteerQueue, TurnContext } from '../types/turn.js';
import { AgentError } from '../errors.js';
import { newId } from '../ids.js';

export function enqueueSteer(queue: SteerQueue, text: string): Promise<void> {
  return new Promise((resolve, reject) => queue.push({ text, resolve, reject }));
}

/**
 * Appends every queued steer to the transcript, emits `run.steered` per message and resolves the submitters
 * (decisions 95-96). Called at the top of every model step, so a steer always lands after the tool results
 * of the batch that preceded it.
 */
export async function drainSteering(ctx: TurnContext): Promise<void> {
  const pending = ctx.steering.splice(0);
  if (pending.length === 0) return;
  const now = new Date().toISOString();
  const messages: Message[] = pending.map((s) => ({ id: newId(), role: 'user', source: 'input', parts: [{ type: 'text', text: s.text }], createdAt: now }));
  await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages });
  for (const message of messages) await ctx.emit({ type: 'run.steered', message });
  for (const s of pending) s.resolve();
}

/** A steer still queued when the run settles is too late; the submitter decides what to do with it (decision 95). */
export function rejectSteering(queue: SteerQueue, runId: string): void {
  for (const s of queue.splice(0)) s.reject(new AgentError({ code: 'not_running', message: `run ${runId} finished before the message was delivered` }));
}
