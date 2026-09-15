import { AgentError, ModelError } from '../errors.js';
import { newId } from '../ids.js';
import { toolCallsOf } from '../message/helpers.js';
import { addUsage } from '../model/usage.js';
import { validateSchema } from '@facio/commands';
import { renderAnswers } from '../tool/ask-user.js';
import type { Agent } from '../types/agent.js';
import type { AskAnswers, AskQuestion } from '../types/ask.js';
import type { CapabilityArgs } from '../types/capability.js';
import type { RunCommand } from '../types/command.js';
import type { RunEventBody } from '../types/event.js';
import type { RunInfo } from '../types/hooks.js';
import type { Message, ToolCallPart, ToolResultPart } from '../types/message.js';
import type { ModelReply, ModelRequest, Usage } from '../types/model.js';
import type { RunOutcome } from '../types/outcome.js';
import type { PendingRequest, SessionRecord, Store } from '../types/store.js';
import type { ModelToolDefinition, Tool } from '../types/tool.js';
import type { RunAbort } from './abort.js';
import { assembleRequest } from './context.js';
import type { Emitter } from './events.js';
import type { InternalRunHandle } from './handle.js';
import { execute, handleToolCall } from './tools.js';
import type { ToolCallDeps, ToolCallResult } from './tools.js';

/** Everything the loop needs; built by run() for a fresh turn and by resume() from a stored run. */
export interface TurnContext {
  agent: Agent<any>;
  store: Store;
  sessionId: string;
  runId: string;
  agentId: string;
  workspace?: string;
  run: RunInfo;
  tools: Map<string, Tool<any, any>>;
  toolDefinitions: ModelToolDefinition[];
  instructions: string;
  abort: RunAbort;
  emit: Emitter['emit'];
  handle: InternalRunHandle;
  counters: { usage: Usage; steps: number; stepIndex: number; toolCalls: number };
  claimed: boolean;
  /** Writer lease timer (decision 68); cleared when the run settles, before the outcome is published. */
  heartbeat?: ReturnType<typeof setInterval>;
}

/** The pending request a command answered, applied to the first call of a resumed batch (decisions 74-77). */
export interface ResolvedRequest {
  pending: PendingRequest;
  command: Exclude<RunCommand, { type: 'cancel' }>;
}

/** Where to enter the loop: a fresh turn, or the rest of a paused batch. */
export type TurnEntry =
  | { kind: 'model' }
  | { kind: 'batch'; calls: ToolCallPart[]; resolved?: ResolvedRequest };

/** Payload of an 'approval' PendingRequest. */
export interface ApprovalPayload { name: string; input: unknown; prompt?: string }
/** Payload of an 'input' PendingRequest; invocationId lets resume complete the same tool step. */
export interface InputPayload { name: string; input: unknown; questions: AskQuestion[]; invocationId: string }

const now = () => new Date().toISOString();

export function createTurnContext(args: {
  agent: Agent<any>;
  store: Store;
  session: SessionRecord;
  runId: string;
  abort: RunAbort;
  emit: Emitter['emit'];
  handle: InternalRunHandle;
  counters: TurnContext['counters'];
  claimed: boolean;
}): TurnContext {
  const { agent, store, session, runId } = args;
  const agentId = agent.definition.id;
  const kv: RunInfo['kv'] = {
    agent: store.kv({ kind: 'agent', agentId }),
    shared: store.kv({ kind: 'shared', namespace: agent.sharedNamespace }),
    ...(session.workspace !== undefined ? { workspace: store.kv({ kind: 'workspace', workspace: session.workspace }) } : {}),
  };
  const tools = new Map<string, Tool<any, any>>(agent.tools);
  return {
    agent, store, runId, agentId,
    sessionId: session.sessionId,
    ...(session.workspace !== undefined ? { workspace: session.workspace } : {}),
    run: { runId, sessionId: session.sessionId, agentId, step: args.counters.steps, kv },
    tools,
    toolDefinitions: [...tools.values()].map((t) => t.toModelDefinition()),
    instructions: agent.definition.instructions,
    abort: args.abort,
    emit: args.emit,
    handle: args.handle,
    counters: args.counters,
    claimed: args.claimed,
  };
}

/**
 * Resolves the agent's capabilities into ctx.tools / ctx.instructions (parent decision 31).
 * Returns false after finishing the run as failed when a capability throws or clashes.
 */
export async function resolveCapabilities(ctx: TurnContext): Promise<boolean> {
  const { agent } = ctx;
  const sections: string[] = [];
  const capArgs: CapabilityArgs = {
    agentId: ctx.agentId, sessionId: ctx.sessionId, runId: ctx.runId,
    ...(ctx.workspace !== undefined ? { workspace: ctx.workspace } : {}),
    kv: ctx.run.kv, signal: ctx.abort.signal,
  };
  for (const cap of agent.capabilities) {
    let contributed: Tool<any, any>[] = [];
    let text: string | undefined;
    try {
      contributed = (await cap.tools?.(capArgs)) ?? [];
      text = await cap.instructions?.(capArgs);
    } catch (e) {
      await finishRun(ctx, fail(ctx, 'capability_error', `capability "${cap.id}": ${(e as Error).message}`, { capability: cap.id }));
      return false;
    }
    for (const tool of contributed) {
      if (ctx.tools.has(tool.name)) {
        await finishRun(ctx, fail(ctx, 'invalid_options', `capability "${cap.id}" contributes a duplicate tool "${tool.name}"`));
        return false;
      }
      ctx.tools.set(tool.name, Object.freeze({ ...tool, source: cap.id }));
    }
    if (text && text.trim()) sections.push(`## ${cap.id}\n${text.trim()}`);
  }
  ctx.instructions = [agent.definition.instructions, ...sections].join('\n\n');
  ctx.toolDefinitions = [...ctx.tools.values()].map((t) => t.toModelDefinition());
  return true;
}

export function fail(ctx: TurnContext, code: string, message: string, detail?: unknown): RunOutcome {
  return { status: 'failed', error: { code, message, ...(detail !== undefined ? { detail } : {}) }, usage: ctx.counters.usage, steps: ctx.counters.steps };
}

export function abortOutcome(ctx: TurnContext): RunOutcome {
  const reason = ctx.abort.reason();
  const { usage, steps } = ctx.counters;
  if (reason?.kind === 'timeout') return { status: 'stopped', reason: 'timeout', usage, steps };
  return { status: 'cancelled', ...(reason?.reason !== undefined ? { reason: reason.reason } : {}), usage, steps };
}

/** Persist the transition, release the claim, then publish (spec: persist before publish). */
export async function finishRun(ctx: TurnContext, outcome: RunOutcome): Promise<void> {
  const { store, sessionId, runId } = ctx;
  await store.runs.update({
    sessionId, runId, status: outcome.status, usage: outcome.usage, steps: outcome.steps,
    ...(outcome.status === 'awaiting' ? { pendingRequestId: outcome.requestId } : {}),
  });
  if (ctx.claimed && outcome.status !== 'awaiting') await store.sessions.releaseWriter({ sessionId, runId });
  await ctx.emit({ type: 'run.finished', outcome });
  settle(ctx, outcome);
}

/** Releases the timers and closes the handle; the last thing every finish path does. */
export function settle(ctx: TurnContext, outcome: RunOutcome): void {
  if (ctx.heartbeat !== undefined) clearInterval(ctx.heartbeat);
  ctx.abort.dispose();
  ctx.handle.finish(outcome);
}

/** Runs the loop until the turn settles. Never throws; every failure becomes a `failed` outcome on the handle. */
export async function runTurn(ctx: TurnContext, entry: TurnEntry): Promise<void> {
  const { agent, store, sessionId, runId, abort, emit, counters } = ctx;
  try {
    if (entry.kind === 'batch') {
      if ((await processCalls(ctx, entry.calls, entry.resolved)) === 'done') return;
    }

    for (;;) {
      if (abort.signal.aborted) return await finishRun(ctx, abortOutcome(ctx));
      if (counters.steps >= agent.limits.maxSteps) return await finishRun(ctx, { status: 'stopped', reason: 'max_steps', usage: counters.usage, steps: counters.steps });
      counters.steps += 1;
      ctx.run.step = counters.steps;

      const history = await store.sessions.listMessages({ sessionId });
      let request: ModelRequest = assembleRequest({
        instructions: ctx.instructions, history, tools: ctx.toolDefinitions, params: agent.params,
        maxTokens: agent.context.maxTokens, estimateTokens: agent.context.estimateTokens, signal: abort.signal,
      });

      const modelInvocationId = newId();
      const modelIndex = counters.stepIndex++;
      const startedAt = now();
      const stepRef = { sessionId, runId, invocationId: modelInvocationId };
      const { signal: _s, ...requestRecord } = request;
      await store.runs.appendStep({ kind: 'model', sessionId, runId, index: modelIndex, invocationId: modelInvocationId, status: 'started', request: requestRecord, startedAt });
      await emit({ type: 'model.started', step: counters.steps });

      // hooks around the model (decisions 21, 58, 59)
      if (agent.hooks.beforeModel) {
        let before;
        try { before = await agent.hooks.beforeModel({ request, run: ctx.run }); }
        catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finishRun(ctx, fail(ctx, 'hook_error', `beforeModel: ${(e as Error).message}`)); }
        if ('abort' in before) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', detail: { abortedBy: 'beforeModel', reason: before.abort.reason }, endedAt: now() } });
          return await finishRun(ctx, { status: 'stopped', reason: 'policy', usage: counters.usage, steps: counters.steps });
        }
        request = before.request;
      }

      let reply: ModelReply;
      try {
        reply = await agent.model.complete(request);
      } catch (e) {
        await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', detail: summarize(e), endedAt: now() } });
        if (abort.signal.aborted) return await finishRun(ctx, abortOutcome(ctx));
        const code = e instanceof ModelError ? e.code : 'internal';
        return await finishRun(ctx, fail(ctx, code, (e as Error).message, summarize(e)));
      }
      // The model consumed these tokens whatever afterModel decides.
      counters.usage = addUsage(counters.usage, reply.usage);

      if (agent.hooks.afterModel) {
        let after;
        try { after = await agent.hooks.afterModel({ reply, run: ctx.run }); }
        catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finishRun(ctx, fail(ctx, 'hook_error', `afterModel: ${(e as Error).message}`)); }
        if ('abort' in after) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord(reply), detail: { abortedBy: 'afterModel', reason: after.abort.reason }, endedAt: now() } });
          return await finishRun(ctx, { status: 'stopped', reason: 'policy', usage: counters.usage, steps: counters.steps });
        }
        reply = after.reply;
      }

      await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord(reply), endedAt: now() } });
      await store.sessions.appendMessages({ sessionId, runId, messages: [reply.message] });
      await emit({ type: 'model.completed', step: counters.steps, message: reply.message, usage: reply.usage, finish: reply.finish });

      const calls = toolCallsOf(reply.message);
      if (calls.length === 0) return await finishRun(ctx, { status: 'completed', message: reply.message, usage: counters.usage, steps: counters.steps });
      if ((await processCalls(ctx, calls)) === 'done') return;
    }
  } catch (e) {
    // A seq gap or a lost claim means another process recovered this run while we were stuck (decision 78):
    // the store is theirs now, so the outcome is delivered without another write.
    if (e instanceof AgentError && (e.code === 'seq_gap' || e.code === 'writer_mismatch')) {
      return settle(ctx, fail(ctx, 'superseded', `run ${runId} was recovered by another process: ${e.message}`, summarize(e)));
    }
    // Store failures and programming errors end here; the outcome is still delivered.
    const outcome = fail(ctx, e instanceof AgentError ? e.code : 'internal', (e as Error).message, summarize(e));
    try { await finishRun(ctx, outcome); }
    catch { settle(ctx, outcome); }
  }
}

/**
 * One batch of tool calls, serially (decisions 54-56). 'done' means the run has been finished (pause, abort,
 * limit or hook failure); 'continue' means every call has a result and the model loop may go on.
 */
async function processCalls(ctx: TurnContext, calls: ToolCallPart[], resolved?: ResolvedRequest): Promise<'continue' | 'done'> {
  const { agent, abort, emit, counters } = ctx;
  const deps: ToolCallDeps = { agent, tools: ctx.tools, run: ctx.run, abort, emit, nextStepIndex: () => counters.stepIndex++ };
  let limitHit = false;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    if (abort.signal.aborted) { await finishRun(ctx, abortOutcome(ctx)); return 'done'; }
    // The human already decided the paused call (decisions 75-77); the limit never applies to it.
    const decided = i === 0 ? resolved : undefined;
    if (!decided && (limitHit || counters.toolCalls >= agent.limits.maxToolCalls)) {
      limitHit = true;
      await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason: 'max_tool_calls' });
      await appendResult(ctx, { type: 'toolResult', callId: call.callId, name: call.name, content: 'Tool call limit reached', isError: true });
      continue;
    }
    let result: ToolCallResult;
    try { result = decided ? await applyResolved(ctx, deps, call, decided) : await handleToolCall(deps, call); }
    catch (e) { await finishRun(ctx, fail(ctx, 'hook_error', `beforeTool/afterTool: ${(e as Error).message}`, summarize(e))); return 'done'; }
    // Denied calls (unknown tool, invalid args, hook deny) never reached an executor and do not count (decision 56).
    if (result.kind !== 'result' || result.executed) counters.toolCalls += 1;

    if (result.kind === 'aborted') { await finishRun(ctx, abortOutcome(ctx)); return 'done'; }
    if (result.kind === 'approval') {
      const payload: ApprovalPayload = { name: result.tool.name, input: result.input, ...(result.prompt !== undefined ? { prompt: result.prompt } : {}) };
      await pause(ctx, { call, kind: 'approval', payload, requested: { type: 'approval.requested', callId: call.callId, ...payload } });
      return 'done';
    }
    if (result.kind === 'input') {
      const payload: InputPayload = { name: result.tool.name, input: result.input, questions: result.questions, invocationId: result.invocationId };
      await pause(ctx, { call, kind: 'input', payload, requested: { type: 'input.requested', callId: call.callId, questions: result.questions } });
      return 'done';
    }
    await appendResult(ctx, result.part);
  }
  if (limitHit) { await finishRun(ctx, { status: 'stopped', reason: 'max_tool_calls', usage: counters.usage, steps: counters.steps }); return 'done'; }
  return 'continue';
}

/** Applies a persisted command to the call it answers. Validation happened in resume() before the command was persisted. */
async function applyResolved(ctx: TurnContext, deps: ToolCallDeps, call: ToolCallPart, resolved: ResolvedRequest): Promise<ToolCallResult> {
  const { command, pending } = resolved;
  if (command.type === 'approve') {
    const payload = pending.payload as ApprovalPayload;
    const tool = ctx.tools.get(payload.name);
    if (!tool) throw new AgentError({ code: 'not_found', message: `tool "${payload.name}" of request ${pending.requestId}` });
    if (command.alwaysApprove) await ctx.run.kv.agent.set(`approvals/${ctx.sessionId}/${tool.name}`, true);
    let input = payload.input;
    if (command.input !== undefined) {
      const validated = validateSchema({ schema: tool.input, value: command.input });
      if (!validated.ok) throw new AgentError({ code: 'internal', message: `approved input of request ${pending.requestId} no longer validates` });
      input = validated.value;
    }
    return execute(deps, call, tool, input);
  }
  if (command.type === 'deny') {
    // No tool.denied event: approval.resolved { decision: 'deny' } already says it (decision 76).
    return { kind: 'result', executed: false, part: { type: 'toolResult', callId: call.callId, name: call.name, content: command.reason ?? 'Denied by the user', isError: true } };
  }
  // answer: complete the tool step left 'started' at the pause (decision 77)
  const payload = pending.payload as InputPayload;
  const answers: AskAnswers = command.answers;
  const content = renderAnswers(payload.questions, answers);
  const step = (await ctx.store.runs.listSteps({ sessionId: ctx.sessionId, runId: ctx.runId })).find((s) => s.invocationId === payload.invocationId);
  const durationMs = step ? Math.max(0, Date.now() - Date.parse(step.startedAt)) : 0;
  await ctx.store.runs.updateStep({ sessionId: ctx.sessionId, runId: ctx.runId, invocationId: payload.invocationId, patch: { status: 'completed', original: { content, isError: false, detail: { answers } }, endedAt: now() } });
  await ctx.emit({ type: 'tool.completed', callId: call.callId, name: payload.name, invocationId: payload.invocationId, content, isError: false, durationMs });
  return { kind: 'result', executed: true, part: { type: 'toolResult', callId: call.callId, name: payload.name, content, isError: false } };
}

/** Persists the request, marks the run awaiting and closes the handle; the writer claim is kept (decision 62). */
type RequestedEvent = Extract<RunEventBody, { type: 'approval.requested' | 'input.requested' }> extends infer E ? (E extends unknown ? Omit<E, 'requestId'> : never) : never;

async function pause(ctx: TurnContext, args: { call: ToolCallPart; kind: 'approval' | 'input'; payload: unknown; requested: RequestedEvent }): Promise<void> {
  const { store, sessionId, runId, counters } = ctx;
  const requestId = newId();
  await store.requests.create({ requestId, sessionId, runId, kind: args.kind, callId: args.call.callId, payload: args.payload, createdAt: now() });
  await ctx.emit({ ...args.requested, requestId } as RunEventBody);
  const outcome: RunOutcome = { status: 'awaiting', sessionId, runId, requestId, kind: args.kind, usage: counters.usage, steps: counters.steps };
  await store.runs.update({ sessionId, runId, status: 'awaiting', pendingRequestId: requestId, usage: outcome.usage, steps: outcome.steps });
  await ctx.emit({ type: 'run.paused', requestId, kind: args.kind });
  await ctx.emit({ type: 'run.finished', outcome });
  settle(ctx, outcome);
}

export async function appendResult(ctx: TurnContext, part: ToolResultPart): Promise<void> {
  const message: Message = { id: newId(), role: 'tool', source: 'tool', parts: [part], createdAt: now() };
  await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages: [message] });
}

/** The provider payload (`raw`) never reaches the step log. */
function replyRecord(reply: ModelReply): Omit<ModelReply, 'raw'> {
  const { raw: _raw, ...record } = reply;
  return record;
}

export function summarize(e: unknown): { name: string; message: string; code?: string; stack?: string } {
  const err = e as Error & { code?: string };
  return { name: err?.name ?? 'Error', message: err?.message ?? String(e), ...(err?.code ? { code: err.code } : {}), ...(err?.stack ? { stack: err.stack } : {}) };
}
