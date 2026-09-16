import type { ToolCallPart } from '../types/message.js';
import type { StepRecord } from '../types/store.js';
import type { Tool, ToolContext, ToolOutput } from '../types/tool.js';
import type { ToolCallDeps, ToolCallResult } from '../types/turn.js';
import { newId } from '../ids.js';
import { validateSchema } from '@facio/sdk';
import { markLoaded } from './deferred.js';
import { PauseSignal } from './pause.js';

/**
 * Validate → beforeTool hook → policy floor → remembered approval → execute (decisions 46, 55, 63).
 * Hook throws propagate as-is; the loop wraps them as hook_error.
 */
export async function handleToolCall(deps: ToolCallDeps, call: ToolCallPart): Promise<ToolCallResult> {
  const { agent, run, emit } = deps;
  const deny = async (reason: string): Promise<ToolCallResult> => {
    await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason });
    return { kind: 'result', executed: false, part: { type: 'toolResult', callId: call.callId, name: call.name, content: reason, isError: true } };
  };

  const tool = deps.tools.get(call.name);
  if (!tool) return deny(`Unknown tool "${call.name}"`);

  await emit({ type: 'tool.proposed', callId: call.callId, name: call.name, input: call.input });

  if (call.input === undefined) return deny('Invalid arguments: not valid JSON');
  const validated = validateSchema({ schema: tool.input, value: call.input });
  if (!validated.ok) return deny(`Invalid arguments: ${formatIssues(validated.issues)}`);
  let input: unknown = validated.value;
  // A valid call to a deferred tool the model never loaded runs anyway (AGENT-02 decision 6) and loads it.
  if (tool.deferred === true) await markLoaded({ loaded: deps.loaded, kv: run.kv.agent, sessionId: run.sessionId }, [tool.name]);

  // Hook first: it may deny, modify, or ask for approval. It cannot lower the policy floor.
  let hookWantsApproval = false;
  let prompt: string | undefined;
  if (agent.hooks.beforeTool) {
    const decision = await agent.hooks.beforeTool({ call, tool, run });
    if (decision.decision === 'deny') return deny(decision.reason);
    if (decision.decision === 'stop') {
      // Nothing executed, so no step record, same as a deny; the loop ends the run (decision 97).
      await emit({ type: 'tool.denied', callId: call.callId, name: call.name, reason: decision.reason });
      return { kind: 'stop', executed: false, stoppedBy: 'beforeTool', reason: decision.reason, part: { type: 'toolResult', callId: call.callId, name: call.name, content: `Not executed: ${decision.reason}`, isError: true } };
    }
    if (decision.decision === 'modify') {
      const again = validateSchema({ schema: tool.input, value: decision.input });
      if (!again.ok) return deny(`Invalid arguments after hook modify: ${formatIssues(again.issues)}`);
      input = again.value;
    }
    if (decision.decision === 'approval') { hookWantsApproval = true; prompt = decision.prompt; }
  }
  const needsApproval = hookWantsApproval || (await agent.policy.requireApproval({ tool, input, run }));
  if (needsApproval) {
    const remembered = await run.kv.agent.get<boolean>(`approvals/${run.sessionId}/${tool.name}`);
    if (remembered !== true) return { kind: 'approval', tool, input, ...(prompt !== undefined ? { prompt } : {}) };
  }

  return executeTool(deps, call, tool, input);
}

export async function executeTool(deps: ToolCallDeps, call: ToolCallPart, tool: Tool<any, any>, input: unknown): Promise<ToolCallResult> {
  const { agent, run, abort, emit } = deps;
  const invocationId = newId();
  const startedAt = new Date().toISOString();
  const index = deps.nextStepIndex();
  const base = { kind: 'tool' as const, sessionId: run.sessionId, runId: run.runId, index, invocationId, callId: call.callId, name: tool.name, input, startedAt };
  await agent.store.runs.appendStep({ ...base, status: 'started' });
  await emit({ type: 'tool.started', callId: call.callId, name: tool.name, invocationId });

  const ctx: ToolContext = {
    agentId: run.agentId, sessionId: run.sessionId, runId: run.runId, callId: call.callId, invocationId,
    signal: abort.signal, kv: run.kv, resources: agent.resources,
  };
  const t0 = Date.now();
  let original: { content: string; isError: boolean; detail?: unknown };
  try {
    // The abandoned executor may still finish and act on the world; that is why the step is marked uncertain.
    const output = await Promise.race([Promise.resolve().then(() => tool.execute(input, ctx)), abort.aborted()]);
    original = { ...normalizeOutput(output), isError: false };
  } catch (e) {
    if (e instanceof PauseSignal) {
      // Step stays 'started'; it completes on resume with the answers (decision 77).
      return { kind: 'input', tool, input, invocationId, questions: e.questions };
    }
    if (abort.signal.aborted) {
      await agent.store.runs.updateStep({ sessionId: run.sessionId, runId: run.runId, invocationId, patch: { status: 'uncertain', endedAt: new Date().toISOString() } });
      return { kind: 'aborted' };
    }
    const err = e as Error;
    original = { content: err?.message || String(e), isError: true, detail: { name: err?.name, stack: err?.stack } };
  }
  const durationMs = Date.now() - t0;

  const bounded = boundOutput(original.content, agent.limits.maxToolOutputChars);
  let content = bounded;
  let isError = original.isError;
  let transformed: { content: string; isError: boolean } | undefined;
  let stop: { reason: string } | undefined;
  if (agent.hooks.afterTool) {
    const after = await agent.hooks.afterTool({ call, tool, output: original.detail !== undefined ? { content, detail: original.detail } : content, isError, run });
    const next = normalizeOutput(after.output);
    content = boundOutput(next.content, agent.limits.maxToolOutputChars);
    isError = after.isError ?? isError;
    if (content !== bounded || isError !== original.isError) transformed = { content, isError };
    stop = after.stop;
  }

  const patch: Partial<StepRecord> = {
    status: original.isError ? 'failed' : 'completed', original,
    ...(transformed ? { transformed } : {}),
    ...(stop ? { detail: { stoppedBy: 'afterTool', reason: stop.reason } } : {}),
    endedAt: new Date().toISOString(),
  };
  await agent.store.runs.updateStep({ sessionId: run.sessionId, runId: run.runId, invocationId, patch });
  await emit({ type: 'tool.completed', callId: call.callId, name: tool.name, invocationId, content, isError, durationMs });
  const part = { type: 'toolResult' as const, callId: call.callId, name: tool.name, content, isError };
  // The result is recorded as usual; the loop ends the run after it (decision 97).
  if (stop) return { kind: 'stop', executed: true, stoppedBy: 'afterTool', reason: stop.reason, part };
  return { kind: 'result', executed: true, part };
}

export function normalizeOutput(output: ToolOutput): { content: string; detail?: unknown } {
  return typeof output === 'string' ? { content: output } : { content: output.content, ...(output.detail !== undefined ? { detail: output.detail } : {}) };
}

export function boundOutput(content: string, max: number): string {
  if (content.length <= max) return content;
  const dropped = content.length - max;
  return `${content.slice(0, max)}\n…[truncated ${dropped} chars]`;
}

function formatIssues(issues: { path: string; message: string }[]): string {
  return issues.map((i) => `${i.path} ${i.message}`).join('; ');
}
