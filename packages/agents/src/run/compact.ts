import type { Message } from '../types/message.js';
import type { ModelReply } from '../types/model.js';
import type { CompactArgs, RunHandle } from '../types/run.js';
import type { TurnContext } from '../types/turn.js';
import { ModelError } from '../errors.js';
import { newId } from '../ids.js';
import { textOf } from '../message/helpers.js';
import { addUsage } from '../model/usage.js';
import { assembleRequest, contextOf, estimateMessageTokens, summarizedIds } from './context.js';
import { start } from './run.js';
import { summarize as describe } from './turn.js';

const now = () => new Date().toISOString();

/** What a `compact()` run says, as its input message; `source: 'system'` so a reader can tell it from the person's words. */
export const COMPACT_INPUT = 'Summarize the conversation so far.';

/**
 * A run whose only step folds the session so far into a summary message (AGENT-01-p5 Task 6): its
 * input is the ask, `source: 'system'`; its outcome's message is the summary. Later requests start
 * at that summary; nothing is deleted.
 */
export function compact<Resources = Record<string, unknown>>(args: CompactArgs<Resources>): RunHandle {
  return start({ agent: args.agent, session: args.session, input: [{ type: 'text', text: COMPACT_INPUT }], ...(args.signal ? { signal: args.signal } : {}) }, true);
}

const SUMMARY_RULES = [
  'Write a summary of the conversation so far, for your own use when you continue it later with only this summary in view.',
  'Cover: what was asked and decided; what was done, with the files, commands and results that matter; what is still open or in progress; every fact needed to continue (paths, names, values, ids).',
  'Plain prose and lists, no preamble, no address to the person. Leave out pleasantries and anything already superseded.',
].join(' ');

const SUMMARY_HEAD = 'Summary of the conversation so far:';

/** Tokens the context a request would carry is estimated at; what the auto-compact threshold is compared with. */
export function historyEstimate(ctx: Pick<TurnContext, 'agent'>, history: Message[]): number {
  return contextOf(history).reduce((n, message) => n + estimateMessageTokens(message, ctx.agent.context.estimateTokens), 0);
}

/**
 * One model step that folds everything no summary stands for yet into a new summary message, appended
 * to the session and announced with `context.compacted`. Used by `compact()` (the whole run) and by
 * the loop when `context.autoCompactTokens` is passed; the latter keeps the turn's own input out of
 * the summary, since it is what the turn is about to answer. Throws what the model throws; the caller
 * decides what that means for the run.
 */
export async function writeSummary(ctx: TurnContext, history: Message[]): Promise<Message> {
  const { agent, store, sessionId, runId, abort, emit, counters } = ctx;
  const already = summarizedIds(history);
  const keep = ctx.compact ? undefined : ctx.inputMessageId;
  const covered = history.filter((message) => !already.has(message.id) && message.id !== keep);
  const estimatedTokens = historyEstimate(ctx, history);
  // A `compact()` run already ends with the ask as its input; an auto-compact asks in passing.
  const ask: Message = { id: newId(), role: 'user', source: 'system', parts: [{ type: 'text', text: COMPACT_INPUT }], createdAt: now() };
  const request = assembleRequest({
    instructions: `${ctx.instructions}\n\n## summary\n${SUMMARY_RULES}`,
    history: ctx.compact ? covered : [...covered, ask],
    tools: [],
    params: agent.params,
    cacheKey: sessionId,
    maxTokens: agent.context.maxTokens,
    estimateTokens: agent.context.estimateTokens,
    signal: abort.signal,
  });

  counters.steps += 1;
  ctx.run.step = counters.steps;
  const invocationId = newId();
  const stepRef = { sessionId, runId, invocationId };
  const { signal: _s, ...requestRecord } = request;
  await store.runs.appendStep({ kind: 'model', sessionId, runId, index: counters.stepIndex++, invocationId, status: 'started', request: requestRecord, startedAt: now() });
  await emit({ type: 'model.started', step: counters.steps });

  let reply: ModelReply;
  try {
    reply = await agent.model.complete(request);
  } catch (e) {
    await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', detail: describe(e), endedAt: now() } });
    throw e;
  }
  counters.usage = addUsage(counters.usage, reply.usage);
  const text = textOf(reply.message).trim();
  if (text === '') {
    await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', reply, endedAt: now() } });
    throw new ModelError({ code: 'invalid_response', message: 'the model returned no summary' });
  }
  await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply, detail: { compacted: covered.length }, endedAt: now() } });
  await emit({ type: 'model.completed', step: counters.steps, message: reply.message, usage: reply.usage, finish: reply.finish });

  const summary: Message = {
    id: newId(),
    role: 'user',
    source: 'summary',
    parts: [{ type: 'text', text: `${SUMMARY_HEAD}\n\n${text}` }],
    createdAt: now(),
    summarizes: covered.map((message) => message.id),
  };
  await store.sessions.appendMessages({ sessionId, runId, messages: [summary] });
  await emit({ type: 'context.compacted', messageId: summary.id, summarized: covered.length, estimatedTokens });
  return summary;
}
