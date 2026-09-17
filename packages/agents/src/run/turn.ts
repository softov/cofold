import type { RunAbort } from '../types/abort.js';
import type { Agent } from '../types/agent.js';
import type { AskAnswers } from '../types/ask.js';
import type { CapabilityArgs } from '../types/capability.js';
import type { Emitter } from '../types/emitter.js';
import type { RunEventBody } from '../types/event.js';
import type { RunInfo } from '../types/hooks.js';
import type { Message, ToolCallPart, ToolResultPart } from '../types/message.js';
import type { ModelReply, ModelRequest } from '../types/model.js';
import type { RunOutcome, RunTally } from '../types/outcome.js';
import type { ApprovalPayload, InputPayload, SessionRecord, Store } from '../types/store.js';
import type { Tool } from '../types/tool.js';
import type {
  InternalRunHandle,
  ResolvedRequest,
  SteerQueue,
  ToolCallDeps,
  ToolCallResult,
  TurnContext,
  TurnEntry,
} from '../types/turn.js';
import { AgentError, ModelError } from '../errors.js';
import { newId } from '../ids.js';
import { toolCallsOf } from '../message/helpers.js';
import { INTERRUPTED, INTERRUPTED_TOOL } from '../message/markers.js';
import { costOf } from '../model/cost.js';
import { addUsage } from '../model/usage.js';
import { validateSchema } from '@facio/sdk';
import { renderAnswers } from '../tool/ask-user.js';
import { historyEstimate, writeSummary } from './compact.js';
import { assembleRequest } from './context.js';
import { LOAD_TOOLS, createLoadToolsTool, instructionsOf, readLoaded, requestToolsOf } from './deferred.js';
import { drainSteering, rejectSteering } from './steering.js';
import { executeTool, handleToolCall } from './tools.js';

const now = () => new Date().toISOString();

export function createTurnContext(args: {
  agent: Agent<any>;
  store: Store;
  session: SessionRecord;
  runId: string;
  abort: RunAbort;
  emit: Emitter['emit'];
  handle: InternalRunHandle;
  steering: SteerQueue;
  counters: TurnContext['counters'];
  claimed: boolean;
  /** A `compact()` run; default false (resume() never resumes one: it has no pause). */
  compact?: boolean;
  inputMessageId?: string;
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
    loaded: new Set(),
    instructions: agent.definition.instructions,
    abort: args.abort,
    emit: args.emit,
    handle: args.handle,
    steering: args.steering,
    counters: args.counters,
    claimed: args.claimed,
    compact: args.compact ?? false,
    ...(args.inputMessageId !== undefined ? { inputMessageId: args.inputMessageId } : {}),
  };
}

/**
 * Resolves the agent's capabilities into ctx.tools / ctx.instructions (parent decision 31), applies their
 * `defer`, reads what this session has loaded, and adds `load_tools` when anything is deferred (AGENT-02).
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
    for (const [index, tool] of contributed.entries()) {
      if (ctx.tools.has(tool.name) || tool.name === LOAD_TOOLS) {
        await finishRun(ctx, fail(ctx, 'invalid_options', `capability "${cap.id}" contributes a duplicate tool "${tool.name}"`));
        return false;
      }
      const deferred = cap.defer === true || (typeof cap.defer === 'object' && index >= cap.defer.over);
      ctx.tools.set(tool.name, Object.freeze({ ...tool, source: cap.id, ...(deferred ? { deferred: true } : {}) }));
    }
    if (text && text.trim()) sections.push(`## ${cap.id}\n${text.trim()}`);
  }
  ctx.instructions = [agent.definition.instructions, ...sections].join('\n\n');
  if ([...ctx.tools.values()].some((tool) => tool.deferred === true)) {
    ctx.loaded = await readLoaded({ tools: ctx.tools, kv: ctx.run.kv.agent, sessionId: ctx.sessionId });
    ctx.tools.set(LOAD_TOOLS, createLoadToolsTool(ctx));
  }
  return true;
}

export function fail(ctx: TurnContext, code: string, message: string, detail?: unknown): RunOutcome {
  return { status: 'failed', error: { code, message, ...(detail !== undefined ? { detail } : {}) }, ...tally(ctx) };
}

export function abortOutcome(ctx: TurnContext): RunOutcome {
  const reason = ctx.abort.reason();
  if (reason?.kind === 'timeout') return { status: 'stopped', reason: 'timeout', ...tally(ctx) };
  return { status: 'cancelled', ...(reason?.reason !== undefined ? { reason: reason.reason } : {}), ...tally(ctx) };
}

/**
 * Answers the calls a cancel cut and writes the marker, so the transcript stays model-valid and says what happened
 * (cli/03 F4); a timeout is an abort too and writes the same texts. Returns the abort outcome for the caller to finish with.
 */
async function interrupt(ctx: TurnContext, calls: ToolCallPart[], from: number): Promise<RunOutcome> {
  for (const call of calls.slice(from)) {
    await appendResult(ctx, { type: 'toolResult', callId: call.callId, name: call.name, content: INTERRUPTED_TOOL, isError: true });
  }
  const marker: Message = { id: newId(), role: 'user', source: 'system', parts: [{ type: 'text', text: INTERRUPTED }], createdAt: now() };
  await ctx.store.sessions.appendMessages({ sessionId: ctx.sessionId, runId: ctx.runId, messages: [marker] });
  return abortOutcome(ctx);
}

/**
 * The counters as every outcome and every run update carries them (decision 109; cli/03 F3): `cost` only when the adapter
 * has pricing, so an unknown price is never recorded as zero; `denials` as a copy, so a later refusal does not change a
 * published outcome.
 */
export function tally(ctx: TurnContext): RunTally {
  const { usage, steps, cost, denials } = ctx.counters;
  return { usage, steps, ...(cost !== undefined ? { cost } : {}), denials: [...denials] };
}

/** Persist the transition, release the claim, then publish (spec: persist before publish). */
export async function finishRun(ctx: TurnContext, outcome: RunOutcome): Promise<void> {
  const { store, sessionId, runId } = ctx;
  await store.runs.update({
    sessionId, runId, status: outcome.status, usage: outcome.usage, steps: outcome.steps,
    ...(outcome.cost !== undefined ? { cost: outcome.cost } : {}),
    ...(outcome.denials !== undefined ? { denials: outcome.denials } : {}),
    ...(outcome.status === 'awaiting' ? { pendingRequestId: outcome.requestId } : {}),
  });
  if (ctx.claimed && outcome.status !== 'awaiting') await store.sessions.releaseWriter({ sessionId, runId });
  await ctx.emit({ type: 'run.finished', outcome });
  settle(ctx, outcome);
}

/** Releases the timers, refuses what the loop never picked up and closes the handle; the last thing every finish path does. */
export function settle(ctx: TurnContext, outcome: RunOutcome): void {
  if (ctx.heartbeat !== undefined) clearInterval(ctx.heartbeat);
  rejectSteering(ctx.steering, ctx.runId);
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
      if (abort.signal.aborted) return await finishRun(ctx, await interrupt(ctx, [], 0));
      // Steers land here, after the previous batch's results and before the step that answers them (decision 96).
      await drainSteering(ctx);
      if (counters.steps >= agent.limits.maxSteps) return await finishRun(ctx, { status: 'stopped', reason: 'max_steps', ...tally(ctx) });
      // The ceiling is checked before a step, so the step that crosses it completes and the next never starts.
      if (agent.limits.maxCost > 0 && counters.cost !== undefined && counters.cost >= agent.limits.maxCost) {
        return await finishRun(ctx, { status: 'stopped', reason: 'max_cost', ...tally(ctx) });
      }
      counters.steps += 1;
      ctx.run.step = counters.steps;

      let history = await store.sessions.listMessages({ sessionId });
      // A compact() run is the summary step and nothing else; a turn compacts in passing when the
      // history has grown past the threshold, then goes on with the summary in place of it.
      const threshold = agent.context.autoCompactTokens;
      if (ctx.compact || (threshold !== undefined && historyEstimate(ctx, history) > threshold)) {
        counters.steps -= 1;
        let summary: Message;
        try { summary = await writeSummary(ctx, history); }
        catch (e) {
          if (abort.signal.aborted) return await finishRun(ctx, await interrupt(ctx, [], 0));
          return await finishRun(ctx, fail(ctx, e instanceof ModelError ? e.code : 'internal', `summary: ${(e as Error).message}`, summarize(e)));
        }
        if (ctx.compact) return await finishRun(ctx, { status: 'completed', message: summary, ...tally(ctx) });
        counters.steps += 1;
        ctx.run.step = counters.steps;
        history = await store.sessions.listMessages({ sessionId });
      }
      let request: ModelRequest = assembleRequest({
        instructions: instructionsOf(ctx), history, tools: requestToolsOf(ctx), params: agent.params, cacheKey: sessionId,
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
          return await finishRun(ctx, { status: 'stopped', reason: 'policy', ...tally(ctx) });
        }
        request = before.request;
      }

      let reply: ModelReply;
      try {
        reply = await callModel(ctx, request);
      } catch (e) {
        await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', detail: summarize(e), endedAt: now() } });
        if (abort.signal.aborted) return await finishRun(ctx, await interrupt(ctx, [], 0));
        const code = e instanceof ModelError ? e.code : 'internal';
        return await finishRun(ctx, fail(ctx, code, (e as Error).message, summarize(e)));
      }
      // The model consumed these tokens whatever afterModel decides.
      counters.usage = addUsage(counters.usage, reply.usage);
      if (agent.model.pricing) counters.cost = (counters.cost ?? 0) + costOf(reply.usage, agent.model.pricing);

      if (agent.hooks.afterModel) {
        let after;
        try { after = await agent.hooks.afterModel({ reply, run: ctx.run }); }
        catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finishRun(ctx, fail(ctx, 'hook_error', `afterModel: ${(e as Error).message}`)); }
        if ('abort' in after) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord(reply), detail: { abortedBy: 'afterModel', reason: after.abort.reason }, endedAt: now() } });
          return await finishRun(ctx, { status: 'stopped', reason: 'policy', ...tally(ctx) });
        }
        reply = after.reply;
      }

      await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord(reply), endedAt: now() } });
      await store.sessions.appendMessages({ sessionId, runId, messages: [reply.message] });
      await emit({ type: 'model.completed', step: counters.steps, message: reply.message, usage: reply.usage, finish: reply.finish });

      const calls = toolCallsOf(reply.message);
      if (calls.length === 0) return await finishRun(ctx, { status: 'completed', message: reply.message, ...tally(ctx) });
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
 * Streams when the adapter can (decision 104); every delta is an event before the next one is read (decision 102).
 * A stream that ends without `done` fails the step: nothing partial was executed, so nothing is uncertain (harness spec).
 */
async function callModel(ctx: TurnContext, request: ModelRequest): Promise<ModelReply> {
  const { agent, emit, counters } = ctx;
  if (!agent.model.stream || !agent.model.features.streaming) return agent.model.complete(request);
  for await (const event of agent.model.stream(request)) {
    if (event.type === 'done') return event.reply;
    if (event.type === 'toolCall.delta') continue; // assembled by the adapter; whole in done.reply (decision 105)
    await emit({ type: 'model.delta', step: counters.steps, kind: event.type === 'text.delta' ? 'text' : 'reasoning', text: event.text });
  }
  throw new ModelError({ code: 'invalid_response', message: 'the stream ended before the reply was complete' });
}

/**
 * One batch of tool calls, serially (decisions 54-56). 'done' means the run has been finished (pause, abort,
 * limit or hook failure); 'continue' means every call has a result and the model loop may go on.
 */
async function processCalls(ctx: TurnContext, calls: ToolCallPart[], resolved?: ResolvedRequest): Promise<'continue' | 'done'> {
  const { agent, abort, emit, counters } = ctx;
  const deps: ToolCallDeps = { agent, tools: ctx.tools, run: ctx.run, abort, emit, nextStepIndex: () => counters.stepIndex++, denied: (denial) => counters.denials.push(denial), loaded: ctx.loaded };
  let limitHit = false;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    // The human already decided the paused call (decisions 75-77); the limit never applies to it, and a persisted
    // decision reaches the transcript even when the run was cancelled meanwhile (decision 120: the cancel's own deny).
    const decided = i === 0 ? resolved : undefined;
    if (!decided && abort.signal.aborted) { await finishRun(ctx, await interrupt(ctx, calls, i)); return 'done'; }
    if (!decided && (limitHit || counters.toolCalls >= agent.limits.maxToolCalls)) {
      limitHit = true;
      counters.denials.push({ callId: call.callId, name: call.name, input: call.input, reason: 'Tool call limit reached', by: 'limit' });
      await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason: 'max_tool_calls' });
      await appendResult(ctx, { type: 'toolResult', callId: call.callId, name: call.name, content: 'Tool call limit reached', isError: true });
      continue;
    }
    let result: ToolCallResult;
    try { result = decided ? await applyResolved(ctx, deps, call, decided) : await handleToolCall(deps, call); }
    catch (e) { await finishRun(ctx, fail(ctx, 'hook_error', `beforeTool/afterTool: ${(e as Error).message}`, summarize(e))); return 'done'; }
    // Denied calls (unknown tool, invalid args, hook deny or stop) never reached an executor and do not count (decision 56).
    if ((result.kind !== 'result' && result.kind !== 'stop') || result.executed) counters.toolCalls += 1;

    if (result.kind === 'aborted') { await finishRun(ctx, await interrupt(ctx, calls, i)); return 'done'; }
    if (result.kind === 'stop') {
      // The rest of the batch is answered so the transcript stays model-valid (decision 90), then the run ends on purpose (decision 97).
      await appendResult(ctx, result.part);
      for (const rest of calls.slice(i + 1)) {
        await appendResult(ctx, { type: 'toolResult', callId: rest.callId, name: rest.name, content: 'Not executed: the run was stopped', isError: true });
      }
      await finishRun(ctx, { status: 'stopped', reason: 'hook', ...tally(ctx) });
      return 'done';
    }
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
  if (limitHit) { await finishRun(ctx, { status: 'stopped', reason: 'max_tool_calls', ...tally(ctx) }); return 'done'; }
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
    return executeTool(deps, call, tool, input);
  }
  if (command.type === 'deny' && pending.kind === 'approval') {
    // No tool.denied event: approval.resolved { decision: 'deny' } already says it (decision 76); the record still lists it (cli/03 F3).
    const reason = command.reason ?? 'Denied by the user';
    ctx.counters.denials.push({ callId: call.callId, name: call.name, input: (pending.payload as ApprovalPayload).input, reason, by: 'user' });
    return { kind: 'result', executed: false, part: { type: 'toolResult', callId: call.callId, name: call.name, content: reason, isError: true } };
  }
  // answer, or a declined question: complete the tool step left 'started' at the pause (decision 77)
  const payload = pending.payload as InputPayload;
  const declined = command.type === 'deny';
  const content = declined ? (command.reason ?? 'The user declined to answer') : renderAnswers(payload.questions, command.answers);
  if (declined) ctx.counters.denials.push({ callId: call.callId, name: payload.name, input: payload.input, reason: content, by: 'user' });
  const step = (await ctx.store.runs.listSteps({ sessionId: ctx.sessionId, runId: ctx.runId })).find((s) => s.invocationId === payload.invocationId);
  const durationMs = step ? Math.max(0, Date.now() - Date.parse(step.startedAt)) : 0;
  await ctx.store.runs.updateStep({
    sessionId: ctx.sessionId, runId: ctx.runId, invocationId: payload.invocationId,
    patch: { status: declined ? 'failed' : 'completed', original: { content, isError: declined, ...(declined ? {} : { detail: { answers: command.answers } }) }, endedAt: now() },
  });
  await ctx.emit({ type: 'tool.completed', callId: call.callId, name: payload.name, invocationId: payload.invocationId, content, isError: declined, durationMs });
  return { kind: 'result', executed: true, part: { type: 'toolResult', callId: call.callId, name: payload.name, content, isError: declined } };
}

/** Persists the request, marks the run awaiting and closes the handle; the writer claim is kept (decision 62). */
type RequestedEvent = Extract<RunEventBody, { type: 'approval.requested' | 'input.requested' }> extends infer E ? (E extends unknown ? Omit<E, 'requestId'> : never) : never;

async function pause(ctx: TurnContext, args: { call: ToolCallPart; kind: 'approval' | 'input'; payload: unknown; requested: RequestedEvent }): Promise<void> {
  const { store, sessionId, runId, counters } = ctx;
  const requestId = newId();
  await store.requests.create({ requestId, sessionId, runId, kind: args.kind, callId: args.call.callId, payload: args.payload, createdAt: now() });
  await ctx.emit({ ...args.requested, requestId } as RunEventBody);
  const outcome: RunOutcome = { status: 'awaiting', sessionId, runId, requestId, kind: args.kind, ...tally(ctx) };
  await store.runs.update({ sessionId, runId, status: 'awaiting', pendingRequestId: requestId, ...tally(ctx) });
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
