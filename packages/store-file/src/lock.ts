import type { WriterLock } from './types/lock.js';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StoreError } from '@cofold/agents';
import type { RunStatus } from '@cofold/agents';
import { readJson, writeAtomic } from './jsonl.js';

const lockFile = (sessionDir: string) => join(sessionDir, 'writer.lock');

export async function readLock(sessionDir: string): Promise<WriterLock | undefined> {
  const lock = await readJson<WriterLock>(lockFile(sessionDir));
  return lock && typeof lock.runId === 'string' && typeof lock.pid === 'number' ? lock : undefined;
}

/**
 * Takes the claim when the session is free, when this run already holds it (a new process resuming its own run
 * re-stamps the pid, which fences the old one), or when the holder is a `running` run whose heartbeat is stale.
 * A paused holder keeps its claim with no expiry.
 */
export async function claim(args: {
  sessionDir: string;
  runId: string;
  staleAfterMs: number;
  runStatus: (runId: string) => Promise<RunStatus | undefined>;
  retried?: boolean;
}): Promise<boolean> {
  const file = lockFile(args.sessionDir);
  const at = new Date().toISOString();
  const lock: WriterLock = { runId: args.runId, pid: process.pid, claimedAt: at, heartbeatAt: at };
  try {
    await writeFile(file, JSON.stringify(lock), { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const current = await readLock(args.sessionDir);
  if (!current) {
    // Torn or vanished between the 'wx' failure and the read: clear it and go through 'wx' once more.
    if (args.retried) throw new StoreError({ code: 'internal', message: `unreadable writer.lock in ${args.sessionDir}` });
    await rm(file, { force: true });
    return claim({ ...args, retried: true });
  }
  if (current.runId === args.runId) {
    if (current.pid !== process.pid) await writeAtomic(file, { ...current, pid: process.pid, heartbeatAt: at });
    return true;
  }
  const status = await args.runStatus(current.runId);
  const stale = status === 'running' && Date.now() - Date.parse(current.heartbeatAt) > args.staleAfterMs;
  if (!stale) return false;
  await writeAtomic(file, lock);
  return true;
}

/** Throws writer_mismatch unless this run, from this process, holds the claim. */
export async function requireOwner(sessionDir: string, runId: string): Promise<WriterLock> {
  const current = await readLock(sessionDir);
  if (!current || current.runId !== runId) {
    throw new StoreError({ code: 'writer_mismatch', message: `run ${runId} is not the writer of ${sessionDir}` });
  }
  if (current.pid !== process.pid) {
    throw new StoreError({ code: 'writer_mismatch', message: `run ${runId} was taken over by pid ${current.pid}` });
  }
  return current;
}

export async function heartbeat(sessionDir: string, runId: string): Promise<void> {
  const current = await requireOwner(sessionDir, runId);
  await writeAtomic(lockFile(sessionDir), { ...current, heartbeatAt: new Date().toISOString() });
}

/** Removes the lock only when it is ours; a lock another process took over is left alone. */
export async function release(sessionDir: string, runId: string): Promise<void> {
  const current = await readLock(sessionDir);
  if (current && current.runId === runId && current.pid === process.pid) await rm(lockFile(sessionDir), { force: true });
}

/** Removes the lock when `runId` holds it, whatever process wrote it: a cut drops the run that held it (p4 fork/rewind). */
export async function clear(sessionDir: string, runId: string): Promise<void> {
  const current = await readLock(sessionDir);
  if (current && current.runId === runId) await rm(lockFile(sessionDir), { force: true });
}

/**
 * Fences a run whose lock was taken over by another process (a zombie): its run-level writes must not land on
 * top of the recovery. A run with no lock, or a lock held by a different run, is not fenced here.
 */
export async function assertNotSuperseded(sessionDir: string, runId: string): Promise<void> {
  const current = await readLock(sessionDir);
  if (current && current.runId === runId && current.pid !== process.pid) {
    throw new StoreError({ code: 'writer_mismatch', message: `run ${runId} was taken over by pid ${current.pid}` });
  }
}
