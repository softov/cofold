import type { ContentPart, ImagePart, Message, TextPart } from '../types/message.js';
import type { Steer, SteerQueue, TurnContext } from '../types/turn.js';
import { AgentError } from '../errors.js';
import { newId } from '../ids.js';

export function enqueueSteer(queue: SteerQueue, text: string, parts?: (TextPart | ImagePart)[]): Promise<void> {
  return new Promise((resolve, reject) => queue.push({ text, ...(parts !== undefined ? { parts } : {}), resolve, reject }));
}

/** The message a steer becomes: its parts, with the text part first unless the text is empty and the parts alone carry the message (decision 95). */
function partsOf(steer: Steer): ContentPart[] {
  const parts = steer.parts ?? [];
  const text: TextPart[] = steer.text === '' && parts.length > 0 ? [] : [{ type: 'text', text: steer.text }];
  return [...text, ...parts];
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
  const messages: Message[] = pending.map((s) => ({ id: newId(), role: 'user', source: 'input', parts: partsOf(s), createdAt: now }));
  await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages });
  for (const message of messages) await ctx.emit({ type: 'run.steered', message });
  for (const s of pending) s.resolve();
}

/** A steer still queued when the run settles is too late; the submitter decides what to do with it (decision 95). */
export function rejectSteering(queue: SteerQueue, runId: string): void {
  for (const s of queue.splice(0)) s.reject(new AgentError({ code: 'not_running', message: `run ${runId} finished before the message was delivered` }));
}
