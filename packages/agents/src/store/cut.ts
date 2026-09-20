import type { Message } from '../types/message.js';
import type { RunStatus } from '../types/outcome.js';
import type { RunRecord, SessionCut } from '../types/store.js';
import { StoreError } from '../errors.js';

/** Anything but these is still moving (`running`) or paused (`awaiting`): never a run of the cut (p4 fork/rewind). */
const NOT_TERMINAL: ReadonlySet<RunStatus> = new Set(['running', 'awaiting']);

/**
 * The one rule both stores cut by (p4 fork/rewind): keep the messages through `throughMessageId`, and a run
 * only when it is terminal and both its `inputMessageId` and its `lastMessageId` are among those messages.
 * A run that is not terminal, or whose span the cut would break, goes with its events, steps and requests.
 * A terminal run missing either slot is dropped: its span cannot be proven to survive the cut. Fails
 * `not_found` for a message the session does not hold.
 */
export function selectCut(args: { sessionId: string; messages: Message[]; runs: RunRecord[]; throughMessageId: string }): SessionCut {
  const cut = args.messages.findIndex((message) => message.id === args.throughMessageId);
  if (cut < 0) throw new StoreError({ code: 'not_found', message: `message ${args.throughMessageId} in session ${args.sessionId}` });
  const messages = args.messages.slice(0, cut + 1);
  const remaining = new Set(messages.map((message) => message.id));
  const runs: RunRecord[] = [];
  const removedRunIds: string[] = [];
  for (const run of args.runs) {
    const kept =
      !NOT_TERMINAL.has(run.status) &&
      run.inputMessageId !== undefined && remaining.has(run.inputMessageId) &&
      run.lastMessageId !== undefined && remaining.has(run.lastMessageId);
    if (kept) runs.push(run);
    else removedRunIds.push(run.runId);
  }
  return { messages, runs, removedRunIds };
}
