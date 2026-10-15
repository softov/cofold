export type AbortReason = { kind: 'cancel'; reason?: string } | { kind: 'timeout' };

/** What a cut turn writes to the transcript: `turn` is the marker message, `tool` answers every call the abort cut. */
export interface InterruptText {
  turn: string;
  tool: string;
}

/** Chooses the texts a cut turn writes from the reason it was cut; the run option `interrupted` (agent/09). */
export type Interrupted = (abort: AbortReason) => InterruptText;

export interface RunAbort {
  signal: AbortSignal;
  abort(reason: AbortReason): void;
  /** The typed reason once aborted; undefined before. */
  reason(): AbortReason | undefined;
  /** Rejects with the AbortReason when the signal fires; used to race tool executions. */
  aborted(): Promise<never>;
  /** Clears the timeout timer and the external listener once the run has settled; the signal stays usable. */
  dispose(): void;
}
