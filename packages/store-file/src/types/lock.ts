/** The writer fence of a session (decision 68). One file, created with 'wx', refreshed by heartbeat. */
export interface WriterLock {
  runId: string;
  pid: number;
  claimedAt: string;
  heartbeatAt: string;
}
