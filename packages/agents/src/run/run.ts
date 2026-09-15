import { AgentError, ModelError } from '../errors.js';
import { newId } from '../ids.js';
import { toolCallsOf } from '../message/helpers.js';
import { ZERO_USAGE, addUsage } from '../model/usage.js';
import type { Agent } from '../types/agent.js';
import type { CapabilityArgs } from '../types/capability.js';
import type { RunInfo } from '../types/hooks.js';
import type { ContentPart, Message, ToolResultPart } from '../types/message.js';
import type { ModelReply, ModelRequest, Usage } from '../types/model.js';
import type { RunOutcome } from '../types/outcome.js';
import type { RunArgs, RunHandle } from '../types/run.js';
import type { PendingRequest, SessionRecord } from '../types/store.js';
import type { ModelToolDefinition, Tool } from '../types/tool.js';
import { createRunAbort } from './abort.js';
import type { RunAbort } from './abort.js';
import { assembleRequest } from './context.js';
import { createEmitter } from './events.js';
import type { Emitter } from './events.js';
import { createRunHandle } from './handle.js';
import type { InternalRunHandle } from './handle.js';
import { handleToolCall } from './tools.js';

/** One turn. Returns synchronously; the loop runs in the background and settles `handle.outcome`. */
export function run<Resources = Record<string, unknown>>(args: RunArgs<Resources>): RunHandle {
  const runId = newId();
  const abort = createRunAbort({ ...(args.signal ? { external: args.signal } : {}), timeoutMs: args.agent.limits.timeoutMs });
  const handle = createRunHandle({ runId, sessionId: args.session, abort });
  void executeRun(args, runId, abort, handle);
  return handle;
}

async function executeRun<Resources>(args: RunArgs<Resources>, runId: string, abort: RunAbort, handle: InternalRunHandle): Promise<void> {
  const { agent } = args;
  const { store } = agent;
  const sessionId = args.session;
  const agentId = agent.definition.id;
  const now = () => new Date().toISOString();
  let usage: Usage = ZERO_USAGE;
  let steps = 0;
  let stepIndex = 0;
  let toolCalls = 0;
  let emitter: Emitter | undefined;
  let claimed = false;

  const fail = (code: string, message: string, detail?: unknown): RunOutcome =>
    ({ status: 'failed', error: { code, message, ...(detail !== undefined ? { detail } : {}) }, usage, steps });

  // Persist the transition, release the claim, then publish (spec: persist before publish).
  const finish = async (outcome: RunOutcome): Promise<void> => {
    await store.runs.update({ sessionId, runId, status: outcome.status, ...(outcome.status === 'awaiting' ? { pendingRequestId: outcome.requestId } : {}) });
    if (claimed && outcome.status !== 'awaiting') await store.sessions.releaseWriter({ sessionId, runId });
    if (emitter) await emitter.emit({ type: 'run.finished', outcome });
    abort.dispose();
    handle.finish(outcome);
  };

  try {
    // 1. session and run record (decision 53: every run has a record)
    let session = await store.sessions.get({ sessionId });
    if (!session) {
      try {
        session = await store.sessions.create({ sessionId, agentId, ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) });
      } catch (e) {
        if ((e as AgentError).code !== 'already_exists') throw e;
        session = (await store.sessions.get({ sessionId })) as SessionRecord;
      }
    }
    await store.runs.create({ runId, sessionId, agentId, status: 'running', createdAt: now(), updatedAt: now() });
    emitter = createEmitter({ store, runId, sessionId, agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn });
    const emit = emitter.emit;

    // 2. writer claim (decision 47: busy → refuse, no queue)
    claimed = await store.sessions.claimWriter({ sessionId, runId });
    if (!claimed) return await finish(fail('writer_busy', `session ${sessionId} is being written by another run`));

    // 3. scopes and run info
    const kv: RunInfo['kv'] = {
      agent: store.kv({ kind: 'agent', agentId }),
      shared: store.kv({ kind: 'shared', namespace: agent.sharedNamespace }),
      ...(session.workspace !== undefined ? { workspace: store.kv({ kind: 'workspace', workspace: session.workspace }) } : {}),
    };
    const run: RunInfo = { runId, sessionId, agentId, step: 0, kv };

    // 4. capabilities (parent decision 31)
    const tools = new Map<string, Tool<any, any>>(agent.tools);
    const sections: string[] = [];
    const capArgs: CapabilityArgs = { agentId, sessionId, runId, ...(session.workspace !== undefined ? { workspace: session.workspace } : {}), kv, signal: abort.signal };
    for (const cap of agent.capabilities) {
      let contributed: Tool[] = [];
      let text: string | undefined;
      try {
        contributed = (await cap.tools?.(capArgs)) ?? [];
        text = await cap.instructions?.(capArgs);
      } catch (e) {
        return await finish(fail('capability_error', `capability "${cap.id}": ${(e as Error).message}`, { capability: cap.id }));
      }
      for (const tool of contributed) {
        if (tools.has(tool.name)) return await finish(fail('invalid_options', `capability "${cap.id}" contributes a duplicate tool "${tool.name}"`));
        tools.set(tool.name, Object.freeze({ ...tool, source: cap.id }));
      }
      if (text && text.trim()) sections.push(`## ${cap.id}\n${text.trim()}`);
    }
    const instructions = [agent.definition.instructions, ...sections].join('\n\n');
    const toolDefinitions: ModelToolDefinition[] = [...tools.values()].map((t) => t.toModelDefinition());

    // 5. input
    const parts: ContentPart[] = typeof args.input === 'string' ? [{ type: 'text', text: args.input }] : args.input;
    const input: Message = { id: newId(), role: 'user', source: 'input', parts, createdAt: now() };
    await store.sessions.appendMessages({ sessionId, runId, messages: [input] });
    await emit({ type: 'run.started', input });

    // 6. loop
    for (;;) {
      if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
      if (steps >= agent.limits.maxSteps) return await finish({ status: 'stopped', reason: 'max_steps', usage, steps });
      steps += 1;
      run.step = steps;

      const history = await store.sessions.listMessages({ sessionId });
      let request: ModelRequest = assembleRequest({
        instructions, history, tools: toolDefinitions, params: agent.params,
        maxTokens: agent.context.maxTokens, estimateTokens: agent.context.estimateTokens, signal: abort.signal,
      });

      const modelInvocationId = newId();
      const modelIndex = stepIndex++;
      const startedAt = now();
      const stepRef = { sessionId, runId, invocationId: modelInvocationId };
      const { signal: _s, ...requestRecord } = request;
      await store.runs.appendStep({ kind: 'model', sessionId, runId, index: modelIndex, invocationId: modelInvocationId, status: 'started', request: requestRecord, startedAt });
      await emit({ type: 'model.started', step: steps });

      // hooks around the model (decisions 21, 58, 59)
      if (agent.hooks.beforeModel) {
        let before;
        try { before = await agent.hooks.beforeModel({ request, run }); }
        catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finish(fail('hook_error', `beforeModel: ${(e as Error).message}`)); }
        if ('abort' in before) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', detail: { abortedBy: 'beforeModel', reason: before.abort.reason }, endedAt: now() } });
          return await finish({ status: 'stopped', reason: 'policy', usage, steps });
        }
        request = before.request;
      }

      let reply: ModelReply;
      try {
        reply = await agent.model.complete(request);
      } catch (e) {
        await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', detail: summarize(e), endedAt: now() } });
        if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
        const code = e instanceof ModelError ? e.code : 'internal';
        return await finish(fail(code, (e as Error).message, summarize(e)));
      }

      if (agent.hooks.afterModel) {
        let after;
        try { after = await agent.hooks.afterModel({ reply, run }); }
        catch (e) { await store.runs.updateStep({ ...stepRef, patch: { status: 'failed', endedAt: now() } }); return await finish(fail('hook_error', `afterModel: ${(e as Error).message}`)); }
        if ('abort' in after) {
          await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply, detail: { abortedBy: 'afterModel', reason: after.abort.reason }, endedAt: now() } });
          return await finish({ status: 'stopped', reason: 'policy', usage, steps });
        }
        reply = after.reply;
      }

      usage = addUsage(usage, reply.usage);
      const { raw: _raw, ...replyRecord } = reply;
      await store.runs.updateStep({ ...stepRef, patch: { status: 'completed', reply: replyRecord, endedAt: now() } });
      await store.sessions.appendMessages({ sessionId, runId, messages: [reply.message] });
      await emit({ type: 'model.completed', step: steps, message: reply.message, usage: reply.usage, finish: reply.finish });

      const calls = toolCallsOf(reply.message);
      if (calls.length === 0) return await finish({ status: 'completed', message: reply.message, usage, steps });

      // 7. tool calls, serially (decisions 54-56)
      const deps = { agent, tools, run, abort, emit, nextStepIndex: () => stepIndex++ };
      let limitHit = false;
      for (const call of calls) {
        if (abort.signal.aborted) return await finish(abortOutcome(abort, usage, steps));
        if (limitHit || toolCalls >= agent.limits.maxToolCalls) {
          limitHit = true;
          await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason: 'max_tool_calls' });
          await appendResult({ type: 'toolResult', callId: call.callId, name: call.name, content: 'Tool call limit reached', isError: true });
          continue;
        }
        toolCalls += 1;
        let result;
        try { result = await handleToolCall(deps, call); }
        catch (e) { return await finish(fail('hook_error', `beforeTool/afterTool: ${(e as Error).message}`, summarize(e))); }

        if (result.kind === 'aborted') return await finish(abortOutcome(abort, usage, steps));
        if (result.kind === 'approval') {
          // Inlined on purpose: keeps the writer claim (decision 62) and writes pendingRequestId.
          const requestId = newId();
          const pending: PendingRequest = {
            requestId, sessionId, runId, kind: 'approval', callId: call.callId,
            payload: { name: result.tool.name, input: result.input, ...(result.prompt !== undefined ? { prompt: result.prompt } : {}) },
            createdAt: now(),
          };
          await store.requests.create(pending);
          await emit({ type: 'approval.requested', requestId, callId: call.callId, name: result.tool.name, input: result.input, ...(result.prompt !== undefined ? { prompt: result.prompt } : {}) });
          const outcome: RunOutcome = { status: 'awaiting', sessionId, runId, requestId, kind: 'approval', usage, steps };
          await store.runs.update({ sessionId, runId, status: 'awaiting', pendingRequestId: requestId });
          await emit({ type: 'run.paused', requestId, kind: 'approval' });
          await emit({ type: 'run.finished', outcome });
          abort.dispose();
          handle.finish(outcome);
          return;
        }
        await appendResult(result.part);
      }
      if (limitHit) return await finish({ status: 'stopped', reason: 'max_tool_calls', usage, steps });
    }
  } catch (e) {
    // Store failures and programming errors end here; the outcome is still delivered.
    const outcome = fail(e instanceof AgentError ? e.code : 'internal', (e as Error).message, summarize(e));
    try { await finish(outcome); }
    catch { abort.dispose(); handle.finish(outcome); }
  }

  async function appendResult(part: ToolResultPart): Promise<void> {
    const message: Message = { id: newId(), role: 'tool', source: 'tool', parts: [part], createdAt: now() };
    await store.sessions.appendMessages({ sessionId, runId, messages: [message] });
  }
}

function abortOutcome(abort: RunAbort, usage: Usage, steps: number): RunOutcome {
  const reason = abort.reason();
  if (reason?.kind === 'timeout') return { status: 'stopped', reason: 'timeout', usage, steps };
  return { status: 'cancelled', ...(reason?.reason !== undefined ? { reason: reason.reason } : {}), usage, steps };
}

function summarize(e: unknown): { name: string; message: string; code?: string; stack?: string } {
  const err = e as Error & { code?: string };
  return { name: err?.name ?? 'Error', message: err?.message ?? String(e), ...(err?.code ? { code: err.code } : {}), ...(err?.stack ? { stack: err.stack } : {}) };
}
