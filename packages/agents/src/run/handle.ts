import type { RunAbort } from '../types/abort.js';
import type { RunCommand } from '../types/command.js';
import type { RunEvent } from '../types/event.js';
import type { ImagePart, TextPart } from '../types/message.js';
import type { RunOutcome, RunStatus } from '../types/outcome.js';
import type { InternalRunHandle } from '../types/turn.js';
import { AgentError } from '../errors.js';

/**
 * Buffers every event for the life of the handle (decision 61): any in-process iterator replays
 * from seq 1 and then follows live. `outcome` never rejects; every failure is a `failed` outcome.
 * A pause keeps the handle open and only moves its status to `awaiting` (decision 122), so `outcome`
 * resolves once, at the run's end, and `finish` is called exactly once. Every stream ends with a
 * `run.finished`, synthesized here when the run did not publish one.
 */
export function createRunHandle(args: {
  runId: string;
  sessionId: string;
  agentId: string;
  abort: RunAbort;
  /** Receives a steer for the running turn; resolves once it is in the transcript (decision 95). */
  steer: (text: string, parts?: (TextPart | ImagePart)[]) => Promise<void>;
  /** Receives approve | deny | answer across the run's own pause (decision 122); both run() and resume() install it. */
  onCommand: (command: Exclude<RunCommand, { type: 'cancel' | 'steer' }>) => Promise<void>;
  /** Leaves a paused run in this process without answering it (review fix 4); does nothing once the run is over. */
  detach: () => void;
  /** The last seq already published when a handle reattaches; the synthesized `run.finished` follows it. Default 0. */
  startSeq?: number;
}): InternalRunHandle {
  const buffer: RunEvent[] = [];
  const waiters: (() => void)[] = [];
  let closed = false;
  let status: RunStatus = 'running';
  let lastSeq = args.startSeq ?? 0;
  let resolveOutcome!: (o: RunOutcome) => void;
  const outcome = new Promise<RunOutcome>((resolve) => { resolveOutcome = resolve; });
  const wake = () => { for (const w of waiters.splice(0)) w(); };

  const events: AsyncIterable<RunEvent> = {
    async *[Symbol.asyncIterator]() {
      let i = 0;
      for (;;) {
        if (i < buffer.length) { yield buffer[i++]!; continue; }
        if (closed) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };

  return {
    runId: args.runId,
    sessionId: args.sessionId,
    status: () => status,
    events,
    outcome,
    cancel: (opts) => args.abort.abort({ kind: 'cancel', ...(opts?.reason !== undefined ? { reason: opts.reason } : {}) }),
    async submit(command: RunCommand) {
      if (command.type === 'cancel') {
        args.abort.abort({ kind: 'cancel', ...(command.reason !== undefined ? { reason: command.reason } : {}) });
        return;
      }
      if (command.type === 'steer') {
        // While the run waits at a pause it is not closed, so a steer lands in its queue and drains after the command.
        if (closed) throw new AgentError({ code: 'not_running', message: `run ${args.runId} is not running` });
        return args.steer(command.text, command.parts);
      }
      // A closed handle has no request left to answer (review fix 3): the run is over, so the command is refused
      // here rather than reaching a loop that, or a context that, has already finished.
      if (closed) throw new AgentError({ code: 'not_running', message: `run ${args.runId} is not running` });
      await args.onCommand(command);
    },
    detach: () => { args.detach(); },
    setStatus: (s) => { status = s; },
    publish: (event) => { lastSeq = event.seq; buffer.push(event); wake(); },
    finish: (o) => {
      // Every stream ends with the run.finished that carries the outcome it settled on (decision 122); a run that
      // never published one - the store refused the write, or the handle finished detached - gets it here. It is
      // the handle's alone: not stored, not handed to onEvent, so no host sees a stream end without one.
      const last = buffer.at(-1);
      if (!(last?.type === 'run.finished' && last.outcome.status === o.status)) {
        lastSeq += 1;
        buffer.push({ seq: lastSeq, runId: args.runId, sessionId: args.sessionId, agentId: args.agentId, at: new Date().toISOString(), type: 'run.finished', outcome: o });
      }
      status = o.status; closed = true; resolveOutcome(o); wake();
    },
  };
}
