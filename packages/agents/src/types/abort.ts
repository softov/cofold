export type AbortReason = { kind: 'cancel'; reason?: string } | { kind: 'timeout' };

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
