import type { RunOutcome } from '../types/outcome.js';
import type { PendingRequest } from '../types/store.js';
import type { ApprovalPayload, InputPayload } from '../types/store.js';
import type { ResolvedRequest, TurnContext } from '../types/turn.js';
import { AgentError } from '../errors.js';
import { validateSchema } from '@cofold/sdk';
import { validateAnswers } from '../tool/ask-user.js';
import { fail, finishRun, settle, storedOutcome } from './turn.js';

type Command = ResolvedRequest['command'];

/** Runs attached in this process (decision 80): a second run() or resume() on a live one is refused. */
export const liveRuns = new Set<string>();

/** The deny a cancel answers an open request with (decision 120), in ahpd's wording. */
export const STOPPED = 'The turn was stopped';

/**
 * Installs the command acceptor on the context and resolves once a valid command has been persisted (decisions 74-77,
 * 122). A cancel while waiting denies the pending request through the same path a host's deny takes (decision 120):
 * the turn then continues, `applyResolved` writes the call's error result, and the loop's abort check writes the
 * marker and finishes it `cancelled`. A request is never left open by a cancel.
 */
export function waitForCommand(ctx: TurnContext, pending: PendingRequest): Promise<Command | undefined> {
  const { store, sessionId, runId } = ctx;
  return new Promise((resolve) => {
    let taken = false;
    /** Takes the acceptor and the abort listener away; `taken` keeps a dropped wait from being answered by the abort. */
    const close = (): void => {
      taken = true;
      ctx.accept = undefined;
      ctx.dropWait = undefined;
      ctx.abort.signal.removeEventListener('abort', onAbort);
    };
    /** Whether the request is no longer open: another process answered it, or the record is gone. */
    const answered = async (): Promise<boolean> => {
      const stored = await store.requests.get({ sessionId, runId, requestId: pending.requestId });
      return stored === undefined || stored.resolvedAt !== undefined;
    };
    const apply = async (command: Command): Promise<void> => {
      // A request another process already answered belongs to the run that holds it now (review fix 1): this handle
      // writes nothing - no resolution, no run update, no finishRun, no releaseWriter - and detaches instead, its
      // own stream ending with the outcome read back from the store.
      if (await answered()) {
        await detachRun(ctx);
        throw new AgentError({ code: 'not_found', message: `request ${pending.requestId} was answered by another process` });
      }
      try {
        await store.requests.resolve({ sessionId, runId, requestId: pending.requestId, resolution: command });
        const reason = command.type === 'deny' && command.reason !== undefined ? { reason: command.reason } : {};
        if (command.type === 'answer') await ctx.emit({ type: 'input.resolved', requestId: pending.requestId, answers: command.answers });
        else if (pending.kind === 'input') await ctx.emit({ type: 'input.declined', requestId: pending.requestId, ...reason });
        else await ctx.emit({ type: 'approval.resolved', requestId: pending.requestId, decision: command.type, ...reason });
        await store.runs.update({ sessionId, runId, status: 'running', pendingRequestId: undefined });
        await ctx.emit({ type: 'run.resumed', requestId: pending.requestId });
      } catch (e) {
        // The write can lose the same race the check above closes: another process answered the request between the
        // read and the resolve, so the store refused this one. The run belongs to that process, so this handle may
        // not finish it either (review fix 1): detach as the early branch does, and write nothing.
        if (await answered()) {
          await detachRun(ctx);
          throw new AgentError({ code: 'not_found', message: `request ${pending.requestId} was answered by another process` });
        }
        const outcome = fail(ctx, e instanceof AgentError ? e.code : 'internal', `persisting the ${command.type} command: ${(e as Error).message}`);
        try { await finishRun(ctx, outcome); } catch { settle(ctx, outcome); }
        resolve(undefined);
        throw e;
      }
      resolve(command);
    };
    const onAbort = () => {
      if (taken) return;
      close();
      // Nothing else is listening: the promise resolves with the command apply persists, or with `undefined` when
      // the request belonged to another process and the handle detached instead. The catch is for the detach's throw.
      void apply({ type: 'deny', requestId: pending.requestId, reason: STOPPED }).catch(() => {});
    };
    if (ctx.abort.signal.aborted) return onAbort();
    ctx.abort.signal.addEventListener('abort', onAbort, { once: true });

    ctx.dropWait = () => {
      if (taken) return;
      close();
      resolve(undefined);
    };
    ctx.accept = async (command) => {
      validateCommand(ctx, pending, command); // throws; nothing changes
      if (taken) throw new AgentError({ code: 'not_found', message: `request ${pending.requestId} is already being resolved` });
      close();
      await apply(command);
    };
  });
}

/**
 * Leaves a paused run in this process without answering it: the wait, the abort listener, the timeout and this
 * process's hold on the run go, and the handle closes with the outcome the store holds - the pause's own `awaiting`
 * when nobody answered it, the real end when another process did (review fixes 1, 4). Nothing is written: the
 * request stays open in the store, so a later `resume()` answers it, here or in another process.
 */
export async function detachRun(ctx: TurnContext): Promise<void> {
  if (ctx.handle.status() !== 'awaiting') return;
  ctx.dropWait?.();
  liveRuns.delete(ctx.runId);
  let outcome: RunOutcome;
  try {
    const record = await ctx.store.runs.get({ sessionId: ctx.sessionId, runId: ctx.runId });
    const events = await ctx.store.runs.listEvents({ sessionId: ctx.sessionId, runId: ctx.runId });
    outcome = storedOutcome(ctx.runId, record, events);
  } catch (e) {
    // The store cannot be read: the handle still ends here rather than staying open on a run nobody holds.
    outcome = fail(ctx, e instanceof AgentError ? e.code : 'internal', `reading run ${ctx.runId} back after detaching: ${(e as Error).message}`);
  }
  settle(ctx, outcome);
}

/** The command a request accepts, checked against what the request asks for (decisions 48, 75-77). */
export function validateCommand(ctx: TurnContext, pending: PendingRequest, command: Command): void {
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
  if (command.type === 'deny') return;
  if (command.type !== 'answer') throw new AgentError({ code: 'invalid_options', message: `request ${pending.requestId} asks for input; use answer or deny` });
  if (!command.answers || typeof command.answers !== 'object' || Array.isArray(command.answers)) {
    throw new AgentError({ code: 'invalid_options', message: 'answers must be an object keyed by question id' });
  }
  const issues = validateAnswers((pending.payload as InputPayload).questions, command.answers);
  if (issues.length) throw new AgentError({ code: 'invalid_options', message: `answers: ${issues.join('; ')}`, detail: issues });
}
