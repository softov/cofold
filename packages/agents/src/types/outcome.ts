import type { Message } from './message.js';
import type { Usage } from './model.js';
import type { Denial } from './store.js';

export type RunStatus = 'running' | 'completed' | 'awaiting' | 'stopped' | 'cancelled' | 'failed';

/**
 * `policy`: a beforeModel / afterModel abort (decision 58); `hook`: a beforeTool / afterTool stop, the run ending on
 * purpose (decision 97); `max_cost`: `limits.maxCost` reached (harness spec: cost limits enforced by the runtime).
 */
export type StopReason = 'max_steps' | 'max_tool_calls' | 'timeout' | 'policy' | 'hook' | 'max_cost';

/**
 * What every outcome carries about the run so far: `cost` (USD) only when the adapter has pricing (decisions 108, 109);
 * `denials`, every refused tool call, the same list the run record holds (cli/03 F3).
 */
export interface RunTally {
  usage: Usage;
  steps: number;
  cost?: number;
  denials?: Denial[];
}

export type RunOutcome =
  | ({ status: 'completed'; message: Message } & RunTally)
  | ({ status: 'awaiting'; sessionId: string; runId: string; requestId: string; kind: 'approval' | 'input' } & RunTally)
  | ({ status: 'stopped'; reason: StopReason } & RunTally)
  | ({ status: 'cancelled'; reason?: string } & RunTally)
  | ({ status: 'failed'; error: { code: string; message: string; detail?: unknown } } & RunTally);
