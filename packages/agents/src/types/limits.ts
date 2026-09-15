export interface Limits {
  /** Model steps per run. */
  maxSteps: number;
  /** Tool executions per run. */
  maxToolCalls: number;
  /** Wall clock for the whole run; 0 = no limit. */
  timeoutMs: number;
  /** Characters of a tool result the model sees; the rest is truncated with a marker. */
  maxToolOutputChars: number;
}
