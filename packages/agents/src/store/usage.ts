import type { Store } from '../types/store.js';
import type { RunUsage, SessionUsage } from '../types/usage.js';
import { ZERO_USAGE, addUsage } from '../model/usage.js';

/**
 * What a session used, from its run records and step logs alone (CLI-06.1): every run oldest first,
 * each with the provider's token counts, its model steps, the tool calls that ran and the ones
 * refused, and the sums. Nothing here prices anything; `RunRecord.cost` is the adapter's concern.
 */
export async function sessionUsage(args: { store: Store; sessionId: string }): Promise<SessionUsage> {
  const { store, sessionId } = args;
  const records = (await store.runs.list({ sessionId })).reverse();
  const runs: RunUsage[] = [];
  for (const record of records) {
    const steps = await store.runs.listSteps({ sessionId, runId: record.runId });
    runs.push({
      runId: record.runId,
      status: record.status,
      createdAt: record.createdAt,
      usage: record.usage,
      steps: record.steps,
      toolCalls: steps.filter((step) => step.kind === 'tool').length,
      denials: record.denials.length,
    });
  }
  return {
    sessionId,
    runs,
    usage: runs.reduce((sum, run) => addUsage(sum, run.usage), ZERO_USAGE),
    steps: runs.reduce((sum, run) => sum + run.steps, 0),
    toolCalls: runs.reduce((sum, run) => sum + run.toolCalls, 0),
    denials: runs.reduce((sum, run) => sum + run.denials, 0),
  };
}
