import type { Usage } from './model.js';
import type { RunStatus } from './outcome.js';

/** What one run of a session used, as its record and step log say. */
export interface RunUsage {
  runId: string;
  status: RunStatus;
  createdAt: string;
  /** The provider's own counts, summed over the run's model steps (`RunRecord.usage`). */
  usage: Usage;
  /** Model steps (`RunRecord.steps`). */
  steps: number;
  /** Tool calls that ran, from the run's `tool` step records. */
  toolCalls: number;
  /** Tool calls refused (`RunRecord.denials`). */
  denials: number;
}

/** What a session used, run by run and in total; tokens only, never a price (CLI-06.1). */
export interface SessionUsage {
  sessionId: string;
  /** Oldest first. */
  runs: RunUsage[];
  usage: Usage;
  steps: number;
  toolCalls: number;
  denials: number;
}
