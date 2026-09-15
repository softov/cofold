import type { RunEvent, RunEventBody } from '../types/event.js';
import type { Store } from '../types/store.js';

export interface Emitter {
  emit(body: RunEventBody): Promise<RunEvent>;
  seq(): number;
}

/** Persist first, publish second (spec "Persist state transitions before publishing them"). */
export function createEmitter(args: {
  store: Store;
  runId: string;
  sessionId: string;
  agentId: string;
  publish: (event: RunEvent) => void;
  onEvent?: ((event: RunEvent) => void) | undefined;
  warn: (message: string) => void;
  /** Last persisted seq when reattaching to a stored run; default 0. */
  startSeq?: number;
}): Emitter {
  let seq = args.startSeq ?? 0;
  return {
    seq: () => seq,
    async emit(body) {
      seq += 1;
      const event = { seq, runId: args.runId, sessionId: args.sessionId, agentId: args.agentId, at: new Date().toISOString(), ...body } as RunEvent;
      await args.store.runs.appendEvent(event);
      args.publish(event);
      if (args.onEvent) {
        try { args.onEvent(event); }
        catch (e) { args.warn(`onEvent observer threw on ${event.type}: ${(e as Error).message}`); }
      }
      return event;
    },
  };
}
