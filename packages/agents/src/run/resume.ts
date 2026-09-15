import { AgentError } from '../errors.js';
import { toolCallsOf } from '../message/helpers.js';
import { ZERO_USAGE, addUsage } from '../model/usage.js';
import { validateSchema } from '@facio/commands';
import { validateAnswers } from '../tool/ask-user.js';
import type { RunCommand } from '../types/command.js';
import type { RunEvent } from '../types/event.js';
import type { ToolCallPart } from '../types/message.js';
import type { RunOutcome } from '../types/outcome.js';
import type { ResumeArgs, RunHandle } from '../types/run.js';
import type { PendingRequest, RunRecord, StepRecord } from '../types/store.js';
import { createRunAbort } from './abort.js';
import { createEmitter } from './events.js';
import { createRunHandle } from './handle.js';
import { startHeartbeat } from './run.js';
import { abortOutcome, appendResult, createTurnContext, fail, finishRun, resolveCapabilities, runTurn, settle } from './turn.js';
import type { ApprovalPayload, InputPayload, ResolvedRequest, TurnContext } from './turn.js';

type Command = ResolvedRequest['command'];

/** Runs attached in this process (decision 80): a second resume() on a live one is refused. */
const liveResumes = new Set<string>();

const now = () => new Date().toISOString();

/**
 * Reattaches to a stored run: replays its events, then continues an `awaiting` run from the command the host
 * submits, recovers a `running` one whose process died (decision 78), or just delivers a terminal outcome (decision 79).
 */
export function resume<Resources = Record<string, unknown>>(args: ResumeArgs<Resources>): RunHandle {
  const { agent, sessionId, runId } = args;
  const store = agent.store;
  const abort = createRunAbort({ timeoutMs: agent.limits.timeoutMs });

  // `submit` may arrive before attach() has read the run; it waits until the handle knows whether a command is wanted.
  let accept: ((command: Command) => Promise<void>) | undefined;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const handle = createRunHandle({
    runId, sessionId, abort,
    onCommand: async (command) => {
      await ready;
      if (!accept) throw new AgentError({ code: 'not_found', message: `run ${runId} is not awaiting a command` });
      await accept(command as Command);
    },
  });

  void attach().finally(markReady);
  return handle;

  /** Handle-only finish for states that must not touch the store (busy, detached, replayed). */
  function finishDetached(outcome: RunOutcome): void {
    abort.dispose();
    handle.finish(outcome);
  }

  async function attach(): Promise<void> {
    let record: RunRecord | undefined;
    try {
      record = await store.runs.get({ sessionId, runId });
    } catch (e) {
      return finishDetached({ status: 'failed', error: { code: e instanceof AgentError ? e.code : 'internal', message: (e as Error).message }, usage: ZERO_USAGE, steps: 0 });
    }
    if (!record) return finishDetached({ status: 'failed', error: { code: 'not_found', message: `run ${runId} in session ${sessionId}` }, usage: ZERO_USAGE, steps: 0 });

    const events = await store.runs.listEvents({ sessionId, runId });
    const lastSeq = events.length ? events[events.length - 1]!.seq : 0;
    const afterSeq = args.afterSeq ?? 0;
    for (const e of events) if (e.seq > afterSeq) handle.publish(e);

    if (record.status !== 'awaiting' && record.status !== 'running') return finishDetached(storedOutcome(record, events));

    if (liveResumes.has(runId)) {
      return finishDetached({ status: 'failed', error: { code: 'writer_busy', message: `run ${runId} is already attached in this process` }, usage: record.usage, steps: record.steps });
    }
    liveResumes.add(runId);
    try {
      const session = await store.sessions.get({ sessionId });
      if (!session) return finishDetached({ status: 'failed', error: { code: 'not_found', message: `session ${sessionId}` }, usage: record.usage, steps: record.steps });

      // An awaiting run still holds its claim (decision 62); re-claiming is idempotent and proves it. A running run's
      // claim is taken over only when the store finds it stale (decision 68).
      const claimed = await store.sessions.claimWriter({ sessionId, runId });
      if (!claimed) return finishDetached({ status: 'failed', error: { code: 'writer_busy', message: `session ${sessionId} is being written by another run` }, usage: record.usage, steps: record.steps });

      const emitter = createEmitter({ store, runId, sessionId, agentId: record.agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn, startSeq: lastSeq });
      const steps = await store.runs.listSteps({ sessionId, runId });
      const counters = countersOf(record, steps);
      const ctx = createTurnContext({ agent, store, session, runId, abort, emit: emitter.emit, handle, counters, claimed: true });
      if (!(await resolveCapabilities(ctx))) return;

      if (record.status === 'running') return await recover(ctx, steps);

      const pending = record.pendingRequestId ? await store.requests.get({ sessionId, runId, requestId: record.pendingRequestId }) : undefined;
      if (!pending) return await finishRun(ctx, fail(ctx, 'not_found', `pending request ${record.pendingRequestId} of run ${runId}`));
      if (pending.resolvedAt) return await finishRun(ctx, fail(ctx, 'interrupted', `request ${pending.requestId} was resolved but the run never continued`, { requestId: pending.requestId }));

      const command = await waitForCommand(ctx, pending);
      if (!command) return;
      ctx.heartbeat = startHeartbeat(store, sessionId, runId);
      const remaining = await remainingCalls(ctx, pending);
      if (!remaining) return;
      await runTurn(ctx, { kind: 'batch', calls: remaining, resolved: { pending, command } });
    } finally {
      liveResumes.delete(runId);
    }
  }

  /**
   * Installs the command acceptor and resolves once a valid command has been persisted (decisions 74-77, 86).
   * Resolves undefined after a cancel: the handle detaches, the request stays open for a later resume().
   */
  function waitForCommand(ctx: TurnContext, pending: PendingRequest): Promise<Command | undefined> {
    return new Promise((resolve) => {
      let taken = false;
      const onAbort = () => {
        if (taken) return;
        taken = true;
        accept = undefined;
        finishDetached(abortOutcome(ctx));
        resolve(undefined);
      };
      if (abort.signal.aborted) return onAbort();
      abort.signal.addEventListener('abort', onAbort, { once: true });

      accept = async (command) => {
        validateCommand(ctx, pending, command); // throws; nothing changes
        if (taken) throw new AgentError({ code: 'not_found', message: `request ${pending.requestId} is already being resolved` });
        taken = true;
        accept = undefined;
        abort.signal.removeEventListener('abort', onAbort);
        try {
          await store.requests.resolve({ sessionId, runId, requestId: pending.requestId, resolution: command });
          if (command.type === 'answer') await ctx.emit({ type: 'input.resolved', requestId: pending.requestId, answers: command.answers });
          else await ctx.emit({ type: 'approval.resolved', requestId: pending.requestId, decision: command.type, ...(command.type === 'deny' && command.reason !== undefined ? { reason: command.reason } : {}) });
          await store.runs.update({ sessionId, runId, status: 'running', pendingRequestId: undefined });
          await ctx.emit({ type: 'run.resumed', requestId: pending.requestId });
        } catch (e) {
          const outcome = fail(ctx, e instanceof AgentError ? e.code : 'internal', `persisting the ${command.type} command: ${(e as Error).message}`);
          try { await finishRun(ctx, outcome); } catch { settle(ctx, outcome); }
          resolve(undefined);
          throw e;
        }
        resolve(command);
      };
      markReady();
    });
  }

  async function recover(ctx: TurnContext, steps: StepRecord[]): Promise<void> {
    let open: StepRecord | undefined;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i]!.status === 'started') { open = steps[i]; break; }
    }
    if (open?.kind === 'tool') {
      await store.runs.updateStep({ sessionId, runId, invocationId: open.invocationId, patch: { status: 'uncertain', endedAt: now() } });
      // The transcript must stay model-valid: every call of the interrupted batch gets a result.
      await appendResult(ctx, { type: 'toolResult', callId: open.callId, name: open.name, content: 'execution outcome unknown: the process died during the call', isError: true });
      for (const call of await unansweredCalls()) {
        if (call.callId === open.callId) continue;
        await appendResult(ctx, { type: 'toolResult', callId: call.callId, name: call.name, content: 'not executed: the run was interrupted', isError: true });
      }
      return finishRun(ctx, fail(ctx, 'uncertain_invocation', `tool "${open.name}" was executing when the process died`, { invocationId: open.invocationId, callId: open.callId }));
    }
    if (open?.kind === 'model') await store.runs.updateStep({ sessionId, runId, invocationId: open.invocationId, patch: { status: 'failed', endedAt: now() } });
    return finishRun(ctx, fail(ctx, 'interrupted', `run ${runId} was running when the process died`));
  }

  /** The calls of the paused batch without a result yet, in order; the paused call must come first (decision 74). */
  async function remainingCalls(ctx: TurnContext, pending: PendingRequest): Promise<ToolCallPart[] | undefined> {
    const remaining = await unansweredCalls();
    if (remaining[0]?.callId !== pending.callId) {
      await finishRun(ctx, fail(ctx, 'internal', `transcript of session ${sessionId} does not match request ${pending.requestId}`, { callId: pending.callId, remaining: remaining.map((c) => c.callId) }));
      return undefined;
    }
    return remaining;
  }

  async function unansweredCalls(): Promise<ToolCallPart[]> {
    const messages = await store.sessions.listMessages({ sessionId });
    let head = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === 'assistant' && toolCallsOf(messages[i]!).length > 0) { head = i; break; }
    }
    if (head < 0) return [];
    const answered = new Set<string>();
    for (const m of messages.slice(head + 1)) for (const p of m.parts) if (p.type === 'toolResult') answered.add(p.callId);
    return toolCallsOf(messages[head]!).filter((c) => !answered.has(c.callId));
  }
}

/**
 * A paused run wrote its counters at the pause (decision 73); a run that died while running never did, so its
 * usage and step count come from the step log.
 */
function countersOf(record: RunRecord, steps: StepRecord[]): TurnContext['counters'] {
  const models = steps.filter((s) => s.kind === 'model');
  const fromLog = record.status === 'running';
  let usage = record.usage;
  if (fromLog) {
    usage = ZERO_USAGE;
    for (const s of models) if (s.kind === 'model' && s.reply) usage = addUsage(usage, s.reply.usage);
  }
  return {
    usage,
    steps: fromLog ? models.length : record.steps,
    stepIndex: steps.length,
    // A step left 'started' at a pause completes (and counts) on resume.
    toolCalls: steps.filter((s) => s.kind === 'tool' && s.status !== 'started').length,
  };
}

function validateCommand(ctx: TurnContext, pending: PendingRequest, command: Command): void {
  if (command.requestId !== pending.requestId) {
    throw new AgentError({ code: 'not_found', message: `request ${command.requestId} is not the pending request ${pending.requestId}` });
  }
  if (pending.kind === 'approval') {
    if (command.type === 'answer') throw new AgentError({ code: 'invalid_options', message: `request ${pending.requestId} is an approval; use approve or deny` });
    if (command.type === 'approve' && command.input !== undefined) {
      const payload = pending.payload as ApprovalPayload;
      const tool = ctx.tools.get(payload.name);
      if (!tool) throw new AgentError({ code: 'not_found', message: `tool "${payload.name}" of request ${pending.requestId} is not available to this agent` });
      const validated = validateSchema({ schema: tool.input, value: command.input });
      if (!validated.ok) throw new AgentError({ code: 'invalid_options', message: `edited input for "${payload.name}": ${validated.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`, detail: validated.issues });
    }
    return;
  }
  if (command.type !== 'answer') throw new AgentError({ code: 'invalid_options', message: `request ${pending.requestId} asks for input; use answer` });
  if (!command.answers || typeof command.answers !== 'object' || Array.isArray(command.answers)) {
    throw new AgentError({ code: 'invalid_options', message: 'answers must be an object keyed by question id' });
  }
  const issues = validateAnswers((pending.payload as InputPayload).questions, command.answers);
  if (issues.length) throw new AgentError({ code: 'invalid_options', message: `answers: ${issues.join('; ')}`, detail: issues });
}

/** The outcome a terminal run recorded; a run that ended without a run.finished event is reported as interrupted. */
function storedOutcome(record: RunRecord, events: RunEvent[]): RunOutcome {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.type === 'run.finished') return e.outcome;
  }
  return { status: 'failed', error: { code: 'interrupted', message: `run ${record.runId} is ${record.status} but recorded no run.finished event` }, usage: record.usage, steps: record.steps };
}
