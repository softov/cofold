import { AgentError } from '../errors.js';
import type { RunCommand } from '../types/command.js';
import type { RunEvent } from '../types/event.js';
import type { RunOutcome, RunStatus } from '../types/outcome.js';
import type { RunHandle } from '../types/run.js';
import type { RunAbort } from './abort.js';

export interface InternalRunHandle extends RunHandle {
  /** Called by the loop for every persisted event. */
  publish(event: RunEvent): void;
  /** Called once by the loop with the final outcome; closes the event stream. */
  finish(outcome: RunOutcome): void;
}

/**
 * Buffers every event for the life of the handle (decision 61): any in-process iterator replays
 * from seq 1 and then follows live. `outcome` never rejects; every failure is a `failed` outcome.
 */
export function createRunHandle(args: {
  runId: string;
  sessionId: string;
  abort: RunAbort;
  /** Receives approve | deny | answer; resume() installs it (decision 86). Absent on a run() handle. */
  onCommand?: (command: RunCommand) => Promise<void>;
}): InternalRunHandle {
  const buffer: RunEvent[] = [];
  const waiters: (() => void)[] = [];
  let closed = false;
  let status: RunStatus = 'running';
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
      if (!args.onCommand) throw new AgentError({ code: 'not_found', message: `no live request for ${command.type}; use resume()` });
      await args.onCommand(command);
    },
    publish: (event) => { buffer.push(event); wake(); },
    finish: (o) => { status = o.status; closed = true; resolveOutcome(o); wake(); },
  };
}
