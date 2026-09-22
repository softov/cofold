import type { FileStoreOptions } from './types/store.js';
import type { WriterLock } from './types/lock.js';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StoreError, selectCut } from '@doopx/agents';
import type { KvScope, KvScopeKey, Message, PendingRequest, RunEvent, RunRecord, RunRef, SessionRecord, StepRecord, Store } from '@doopx/agents';
import { appendLine, readJson, readLines, writeAtomic, writeLines } from './jsonl.js';
import * as lock from './lock.js';
import { decodeSegment, encodeSegment } from './paths.js';
import { workspaceSlug } from './slug.js';

/** Serialized step detail above this is replaced by `{ truncated: true, bytes }` (decision 70). */
export const DETAIL_CAP_BYTES = 262_144;

/**
 * Layout (decision 81):
 *   <root>/sessions/<sessionId>/                      sessions without a workspace
 *   <root>/workspaces/<slug>/sessions/<sessionId>/    sessions with one
 *     session.json  messages.jsonl  writer.lock  runs/<runId>/{run.json, events.jsonl, steps.jsonl, requests/<requestId>.json}
 *   <root>/workspaces/<slug>/kv/<key>.json  <root>/kv/agent/<agentId>/<key>.json  <root>/kv/shared/<namespace>/<key>.json
 */
export function createFileStore(options: FileStoreOptions): Store {
  const root = resolve(options.root);
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  const sessionsRoot = join(root, 'sessions');
  const workspacesRoot = join(root, 'workspaces');
  /** sessionId -> folder; saves the workspaces scan after the first lookup (decision 83). */
  const sessionDirs = new Map<string, string>();
  /** runDir -> last persisted seq; the writer fence makes it authoritative within a process (decision 82). */
  const lastSeq = new Map<string, number>();
  const now = () => new Date().toISOString();

  async function findSessionDir(sessionId: string): Promise<string | undefined> {
    const cached = sessionDirs.get(sessionId);
    if (cached) return cached;
    const segment = encodeSegment(sessionId);
    const direct = join(sessionsRoot, segment);
    if (await exists(join(direct, 'session.json'))) return remember(sessionId, direct);
    for (const slug of await listDir(workspacesRoot)) {
      const dir = join(workspacesRoot, slug, 'sessions', segment);
      if (await exists(join(dir, 'session.json'))) return remember(sessionId, dir);
    }
    return undefined;
  }
  function remember(sessionId: string, dir: string): string {
    sessionDirs.set(sessionId, dir);
    return dir;
  }
  async function requireSessionDir(sessionId: string): Promise<string> {
    const dir = await findSessionDir(sessionId);
    if (!dir) throw new StoreError({ code: 'not_found', message: `session ${sessionId}` });
    return dir;
  }
  const runDirOf = (sessionDir: string, runId: string) => join(sessionDir, 'runs', encodeSegment(runId));
  async function requireRunDir(ref: RunRef): Promise<{ sessionDir: string; runDir: string }> {
    const sessionDir = await findSessionDir(ref.sessionId);
    const runDir = sessionDir ? runDirOf(sessionDir, ref.runId) : undefined;
    if (!sessionDir || !runDir || !(await exists(join(runDir, 'run.json')))) {
      throw new StoreError({ code: 'not_found', message: `run ${ref.runId} in session ${ref.sessionId}` });
    }
    return { sessionDir, runDir };
  }
  /** session.json never stores the writer; the lock file is the one source (decision 68). */
  async function readSession(dir: string): Promise<SessionRecord | undefined> {
    const record = await readJson<SessionRecord>(join(dir, 'session.json'));
    if (!record) return undefined;
    const holder = await lock.readLock(dir);
    return holder ? { ...record, activeWriterRunId: holder.runId } : record;
  }
  // A run.json written before denials existed (agent/04 task 02) reads back with an empty list.
  const readRun = async (runDir: string): Promise<RunRecord | undefined> => {
    const record = await readJson<RunRecord>(join(runDir, 'run.json'));
    return record && !Array.isArray(record.denials) ? { ...record, denials: [] } : record;
  };
  const requestFile = (runDir: string, requestId: string) => join(runDir, 'requests', `${encodeSegment(requestId)}.json`);
  /** Every run of a session, for a cut to decide over (p4 fork/rewind). */
  const readRuns = async (sessionDir: string): Promise<RunRecord[]> => {
    const records: RunRecord[] = [];
    for (const name of await listDir(join(sessionDir, 'runs'))) {
      const record = await readRun(join(sessionDir, 'runs', name));
      if (record) records.push(record);
    }
    return records;
  };
  /** The claim holder, unless it is a `running` run: that one is writing and refuses a cut, as it refuses delete. */
  async function writerHolder(dir: string, sessionId: string): Promise<WriterLock | undefined> {
    const holder = await lock.readLock(dir);
    if (holder && (await readRun(runDirOf(dir, holder.runId)))?.status === 'running') {
      throw new StoreError({ code: 'writer_busy', message: `session ${sessionId} is being written by run ${holder.runId}` });
    }
    return holder;
  }

  return {
    sessions: {
      async get({ sessionId }) {
        const dir = await findSessionDir(sessionId);
        return dir ? readSession(dir) : undefined;
      },
      async create({ sessionId, agentId, workspace }) {
        if (await findSessionDir(sessionId)) throw new StoreError({ code: 'already_exists', message: `session ${sessionId}` });
        const segment = encodeSegment(sessionId);
        const dir = workspace !== undefined ? join(workspacesRoot, workspaceSlug({ workspace }), 'sessions', segment) : join(sessionsRoot, segment);
        const record: SessionRecord = { sessionId, agentId, ...(workspace !== undefined ? { workspace } : {}), createdAt: now(), updatedAt: now() };
        await writeAtomic(join(dir, 'session.json'), record);
        remember(sessionId, dir);
        return { ...record };
      },
      async list({ workspace, agentId, limit }) {
        const dirs: string[] = [];
        const collect = async (base: string) => { for (const name of await listDir(base)) dirs.push(join(base, name)); };
        if (workspace !== undefined) await collect(join(workspacesRoot, workspaceSlug({ workspace }), 'sessions'));
        else {
          await collect(sessionsRoot);
          for (const slug of await listDir(workspacesRoot)) await collect(join(workspacesRoot, slug, 'sessions'));
        }
        const records: SessionRecord[] = [];
        for (const dir of dirs) {
          const s = await readSession(dir);
          if (s && (agentId === undefined || s.agentId === agentId)) records.push(s);
        }
        records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
        return limit ? records.slice(0, limit) : records;
      },
      async delete({ sessionId }) {
        const dir = await requireSessionDir(sessionId);
        await writerHolder(dir, sessionId);
        await rm(dir, { recursive: true, force: true });
        sessionDirs.delete(sessionId);
        for (const key of [...lastSeq.keys()]) if (key.startsWith(dir)) lastSeq.delete(key);
      },
      async truncate({ sessionId, throughMessageId }) {
        const dir = await requireSessionDir(sessionId);
        const holder = await writerHolder(dir, sessionId);
        const messages = await readLines<Message>(join(dir, 'messages.jsonl'));
        const cut = selectCut({ sessionId, messages, runs: await readRuns(dir), throughMessageId });
        await writeLines(join(dir, 'messages.jsonl'), cut.messages);
        for (const runId of cut.removedRunIds) {
          const runDir = runDirOf(dir, runId);
          await rm(runDir, { recursive: true, force: true });
          for (const key of [...lastSeq.keys()]) if (key.startsWith(runDir)) lastSeq.delete(key);
        }
        const record = await readJson<SessionRecord>(join(dir, 'session.json'));
        if (record) await writeAtomic(join(dir, 'session.json'), { ...record, updatedAt: now() });
        if (holder && cut.removedRunIds.includes(holder.runId)) await lock.clear(dir, holder.runId);
        return { remainingMessages: cut.messages.length, removedMessages: messages.length - cut.messages.length, removedRuns: cut.removedRunIds.length };
      },
      async fork({ fromSessionId, throughMessageId, sessionId }) {
        const sourceDir = await requireSessionDir(fromSessionId);
        await writerHolder(sourceDir, fromSessionId);
        if (await findSessionDir(sessionId)) throw new StoreError({ code: 'already_exists', message: `session ${sessionId}` });
        const source = await readSession(sourceDir);
        if (!source) throw new StoreError({ code: 'not_found', message: `session ${fromSessionId}` });
        const messages = await readLines<Message>(join(sourceDir, 'messages.jsonl'));
        const cut = selectCut({ sessionId: fromSessionId, messages, runs: await readRuns(sourceDir), throughMessageId });
        const segment = encodeSegment(sessionId);
        const targetDir = source.workspace !== undefined
          ? join(workspacesRoot, workspaceSlug({ workspace: source.workspace }), 'sessions', segment)
          : join(sessionsRoot, segment);
        const record: SessionRecord = {
          sessionId,
          agentId: source.agentId,
          ...(source.workspace !== undefined ? { workspace: source.workspace } : {}),
          createdAt: now(),
          updatedAt: now(),
        };
        await writeAtomic(join(targetDir, 'session.json'), record);
        await writeLines(join(targetDir, 'messages.jsonl'), cut.messages);
        for (const run of cut.runs) {
          const sourceRunDir = runDirOf(sourceDir, run.runId);
          const targetRunDir = runDirOf(targetDir, run.runId);
          await writeAtomic(join(targetRunDir, 'run.json'), { ...run, sessionId });
          const events = await readLines<RunEvent>(join(sourceRunDir, 'events.jsonl'));
          if (events.length > 0) await writeLines(join(targetRunDir, 'events.jsonl'), events.map((event) => ({ ...event, sessionId })));
          const steps = await readLines<StepRecord>(join(sourceRunDir, 'steps.jsonl'));
          if (steps.length > 0) await writeLines(join(targetRunDir, 'steps.jsonl'), steps.map((step) => ({ ...step, sessionId })));
        }
        remember(sessionId, targetDir);
        return { ...record };
      },
      async appendMessages({ sessionId, runId, messages }) {
        const dir = await requireSessionDir(sessionId);
        await lock.requireOwner(dir, runId);
        for (const m of messages) await appendLine(join(dir, 'messages.jsonl'), m);
        const record = await readJson<SessionRecord>(join(dir, 'session.json'));
        if (record) await writeAtomic(join(dir, 'session.json'), { ...record, updatedAt: now() });
        // The run's span ends at the last message it appended, so the record a
        // cut reads says where this run ended (p4 fork/rewind). The claim above
        // is what makes this writer the only one moving the same run.
        const last = messages.at(-1);
        if (last !== undefined) {
          const runDir = runDirOf(dir, runId);
          const run = await readRun(runDir);
          if (run) await writeAtomic(join(runDir, 'run.json'), { ...run, lastMessageId: last.id, updatedAt: now() });
        }
      },
      async listMessages({ sessionId, limit }) {
        const dir = await requireSessionDir(sessionId);
        const all = await readLines<Message>(join(dir, 'messages.jsonl'));
        return limit ? all.slice(-limit) : all;
      },
      async claimWriter({ sessionId, runId }) {
        const dir = await requireSessionDir(sessionId);
        return lock.claim({ sessionDir: dir, runId, staleAfterMs, runStatus: async (id) => (await readRun(runDirOf(dir, id)))?.status });
      },
      async releaseWriter({ sessionId, runId }) {
        await lock.release(await requireSessionDir(sessionId), runId);
      },
      async heartbeat({ sessionId, runId }) {
        await lock.heartbeat(await requireSessionDir(sessionId), runId);
      },
    },
    runs: {
      async create(record) {
        const sessionDir = await requireSessionDir(record.sessionId);
        const runDir = runDirOf(sessionDir, record.runId);
        if (await exists(join(runDir, 'run.json'))) throw new StoreError({ code: 'already_exists', message: `run ${record.runId}` });
        await writeAtomic(join(runDir, 'run.json'), record);
      },
      async get(ref) {
        const sessionDir = await findSessionDir(ref.sessionId);
        return sessionDir ? readRun(runDirOf(sessionDir, ref.runId)) : undefined;
      },
      async list({ sessionId, status }) {
        const sessionDir = await requireSessionDir(sessionId);
        const records: RunRecord[] = [];
        for (const name of await listDir(join(sessionDir, 'runs'))) {
          const r = await readRun(join(sessionDir, 'runs', name));
          if (r && (status === undefined || r.status === status)) records.push(r);
        }
        return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      },
      async update({ sessionId, runId, status, usage, steps, cost, denials, lastMessageId, ...rest }) {
        const { sessionDir, runDir } = await requireRunDir({ sessionId, runId });
        await lock.assertNotSuperseded(sessionDir, runId);
        const r = (await readRun(runDir)) as RunRecord;
        r.status = status;
        r.updatedAt = now();
        // Only an explicit `pendingRequestId: undefined` clears it; an absent key leaves it alone.
        if ('pendingRequestId' in rest) {
          if (rest.pendingRequestId === undefined) delete r.pendingRequestId;
          else r.pendingRequestId = rest.pendingRequestId;
        }
        if (usage) r.usage = usage;
        if (steps !== undefined) r.steps = steps;
        if (cost !== undefined) r.cost = cost;
        if (denials !== undefined) r.denials = denials;
        if (lastMessageId !== undefined) r.lastMessageId = lastMessageId;
        await writeAtomic(join(runDir, 'run.json'), r);
      },
      async appendEvent(event) {
        const { sessionDir, runDir } = await requireRunDir(event);
        await lock.assertNotSuperseded(sessionDir, event.runId);
        const file = join(runDir, 'events.jsonl');
        let last = lastSeq.get(runDir);
        if (last === undefined) {
          const lines = await readLines<RunEvent>(file);
          last = lines.length ? lines[lines.length - 1]!.seq : 0;
        }
        if (event.seq !== last + 1) {
          throw new StoreError({ code: 'seq_gap', message: `run ${event.runId}: expected seq ${last + 1}, got ${event.seq}` });
        }
        await appendLine(file, event);
        lastSeq.set(runDir, event.seq);
      },
      async listEvents({ sessionId, runId, afterSeq = 0 }) {
        const { runDir } = await requireRunDir({ sessionId, runId });
        return (await readLines<RunEvent>(join(runDir, 'events.jsonl'))).filter((e) => e.seq > afterSeq);
      },
      async appendStep(step) {
        const { sessionDir, runDir } = await requireRunDir(step);
        await lock.assertNotSuperseded(sessionDir, step.runId);
        await appendLine(join(runDir, 'steps.jsonl'), capDetail(step));
      },
      async updateStep({ sessionId, runId, invocationId, patch }) {
        const { sessionDir, runDir } = await requireRunDir({ sessionId, runId });
        await lock.assertNotSuperseded(sessionDir, runId);
        const file = join(runDir, 'steps.jsonl');
        const current = foldSteps(await readLines<StepRecord>(file)).find((s) => s.invocationId === invocationId);
        if (!current) throw new StoreError({ code: 'not_found', message: `step ${invocationId}` });
        await appendLine(file, capDetail({ ...current, ...patch } as StepRecord));
      },
      async listSteps(ref) {
        const { runDir } = await requireRunDir(ref);
        return foldSteps(await readLines<StepRecord>(join(runDir, 'steps.jsonl')));
      },
    },
    requests: {
      async create(request) {
        const { sessionDir, runDir } = await requireRunDir(request);
        await lock.assertNotSuperseded(sessionDir, request.runId);
        await writeAtomic(requestFile(runDir, request.requestId), request);
      },
      async get({ sessionId, runId, requestId }) {
        const sessionDir = await findSessionDir(sessionId);
        if (!sessionDir) return undefined;
        return readJson<PendingRequest>(requestFile(runDirOf(sessionDir, runId), requestId));
      },
      async resolve({ sessionId, runId, requestId, resolution }) {
        const { sessionDir, runDir } = await requireRunDir({ sessionId, runId });
        await lock.assertNotSuperseded(sessionDir, runId);
        const file = requestFile(runDir, requestId);
        const r = await readJson<PendingRequest>(file);
        if (!r) throw new StoreError({ code: 'not_found', message: `request ${requestId} in run ${runId}` });
        await writeAtomic(file, { ...r, resolution, resolvedAt: now() });
      },
    },
    kv(scope) {
      const dir = kvDir(scope);
      const fileOf = (key: string) => join(dir, `${encodeSegment(key)}.json`);
      return {
        async get<T = unknown>(key: string) { return readJson<T>(fileOf(key)); },
        async set(key, value) { await writeAtomic(fileOf(key), value); },
        async delete(key) { await rm(fileOf(key), { force: true }); },
        async list(prefix = '') {
          const names = await listDir(dir);
          return names.filter((n) => n.endsWith('.json')).map((n) => decodeSegment(n.slice(0, -'.json'.length))).filter((k) => k.startsWith(prefix));
        },
      } satisfies KvScope;
    },
  };

  function kvDir(scope: KvScopeKey): string {
    switch (scope.kind) {
      case 'agent': return join(root, 'kv', 'agent', encodeSegment(scope.agentId));
      case 'shared': return join(root, 'kv', 'shared', encodeSegment(scope.namespace));
      case 'workspace': return join(workspacesRoot, workspaceSlug({ workspace: scope.workspace }), 'kv');
    }
  }
}

/** A later line with the same invocationId supersedes the earlier one; order is first appearance (decision 82). */
export function foldSteps(lines: StepRecord[]): StepRecord[] {
  const byId = new Map<string, StepRecord>();
  for (const line of lines) byId.set(line.invocationId, line);
  return [...byId.values()];
}

function capDetail(step: StepRecord): StepRecord {
  if (step.kind === 'model' && step.detail !== undefined) return { ...step, detail: cap(step.detail) };
  if (step.kind === 'tool' && step.original && step.original.detail !== undefined) {
    return { ...step, original: { ...step.original, detail: cap(step.original.detail) } };
  }
  return step;
}

function cap(detail: unknown): unknown {
  const bytes = Buffer.byteLength(JSON.stringify(detail) ?? '');
  return bytes > DETAIL_CAP_BYTES ? { truncated: true, bytes } : detail;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try { return (await readdir(dir)).sort(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
