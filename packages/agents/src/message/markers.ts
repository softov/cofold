import type { AbortReason, InterruptText } from '../types/abort.js';

/**
 * What a cancelled run writes to the transcript (cli/03 F4), in Claude's runtime's wording so one projection reads
 * both: the marker is a `role: 'user'`, `source: 'system'` message; the tool text answers every call the cancel cut.
 */
export const INTERRUPTED = '[Request interrupted by user]';
export const INTERRUPTED_TOOL = '[Request interrupted by user for tool use]';

/**
 * The texts a cut turn writes when the caller sets none (agent/09): a cancel with no reason, or with the harness's own
 * `'signal'`, writes `INTERRUPTED` and `INTERRUPTED_TOOL`; a cancel with a reason and a timeout name it.
 */
export function interruptedText(abort: AbortReason): InterruptText {
  const reason = abort.kind === 'timeout' ? 'timeout' : abort.reason;
  if (reason === undefined || (abort.kind === 'cancel' && reason === 'signal')) return { turn: INTERRUPTED, tool: INTERRUPTED_TOOL };
  return { turn: `[Request interrupted: ${reason}]`, tool: `[Request interrupted for tool use: ${reason}]` };
}
