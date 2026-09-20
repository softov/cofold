import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type {
  KvScope,
  PendingRequest,
  RunRecord,
  RunRef,
  SessionRecord,
  StepRecord,
  Store,
} from '../types/store.js';
import { StoreError } from '../errors.js';
import { selectCut } from './cut.js';

type StoredRun = RunRecord & { events: RunEvent[]; stepLog: StepRecord[] };

export function createMemoryStore(): Store {
  const sessions = new Map<string, SessionRecord & { messages: Message[] }>();
  // `stepLog`, not `steps`: RunRecord.steps is the loop's counter (decision 73).
  // Keyed by session and run: a fork may copy a run id into another session (p4 fork/rewind).
  const runs = new Map<string, StoredRun>();
  const requests = new Map<string, PendingRequest>();
  /** One entry map per kv scope, keyed "agent:<agentId>", "shared:<namespace>" or "workspace:<workspace>". */
  const scopes = new Map<string, Map<string, unknown>>();
  const now = () => new Date().toISOString();
  const runKey = (sessionId: string, runId: string) => `${sessionId}\u0000${runId}`;

  const requireRun = (ref: RunRef) => {
    const run = runs.get(runKey(ref.sessionId, ref.runId));
    if (!run) throw new StoreError({ code: 'not_found', message: `run ${ref.runId} in session ${ref.sessionId}` });
    return run;
  };
  const requireSession = (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (!s) throw new StoreError({ code: 'not_found', message: `session ${sessionId}` });
    return s;
  };
  const requireWriter = (sessionId: string, runId: string) => {
    const s = requireSession(sessionId);
    if (s.activeWriterRunId !== runId) {
      throw new StoreError({ code: 'writer_mismatch', message: `run ${runId} is not the writer of session ${sessionId}` });
    }
    return s;
  };
  /** A `running` claim holder is writing; refuses the same way a cut does for `delete`. A paused holder does not. */
  const requireFreeWriter = (s: SessionRecord & { messages: Message[] }, sessionId: string) => {
    if (s.activeWriterRunId !== undefined && runs.get(runKey(sessionId, s.activeWriterRunId))?.status === 'running') {
      throw new StoreError({ code: 'writer_busy', message: `session ${sessionId} is being written by run ${s.activeWriterRunId}` });
    }
  };

  return {
    sessions: {
      async get({ sessionId }) {
        const s = sessions.get(sessionId);
        return s ? stripSession(s) : undefined;
      },
      async create({ sessionId, agentId, workspace }) {
        if (sessions.has(sessionId)) throw new StoreError({ code: 'already_exists', message: `session ${sessionId}` });
        const record: SessionRecord & { messages: Message[] } = {
          sessionId,
          agentId,
          ...(workspace !== undefined ? { workspace } : {}),
          createdAt: now(),
          updatedAt: now(),
          messages: [],
        };
        sessions.set(sessionId, record);
        return stripSession(record);
      },
      async list({ workspace, agentId, limit }) {
        const all = [...sessions.values()]
          .filter((s) => (workspace === undefined || s.workspace === workspace) && (agentId === undefined || s.agentId === agentId))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
          .map(stripSession);
        return limit ? all.slice(0, limit) : all;
      },
      async delete({ sessionId }) {
        const s = requireSession(sessionId);
        requireFreeWriter(s, sessionId);
        for (const [key, run] of runs) if (run.sessionId === sessionId) runs.delete(key);
        for (const [requestId, request] of requests) if (request.sessionId === sessionId) requests.delete(requestId);
        sessions.delete(sessionId);
      },
      async truncate({ sessionId, throughMessageId }) {
        const s = requireSession(sessionId);
        requireFreeWriter(s, sessionId);
        const cut = selectCut({ sessionId, messages: s.messages, runs: [...runs.values()].filter((run) => run.sessionId === sessionId), throughMessageId });
        const removedMessages = s.messages.length - cut.messages.length;
        s.messages.splice(cut.messages.length);
        for (const runId of cut.removedRunIds) {
          runs.delete(runKey(sessionId, runId));
          for (const [requestId, request] of requests) if (request.sessionId === sessionId && request.runId === runId) requests.delete(requestId);
        }
        if (s.activeWriterRunId !== undefined && cut.removedRunIds.includes(s.activeWriterRunId)) delete s.activeWriterRunId;
        s.updatedAt = now();
        return { remainingMessages: cut.messages.length, removedMessages, removedRuns: cut.removedRunIds.length };
      },
      async fork({ fromSessionId, throughMessageId, sessionId }) {
        const source = requireSession(fromSessionId);
        requireFreeWriter(source, fromSessionId);
        if (sessions.has(sessionId)) throw new StoreError({ code: 'already_exists', message: `session ${sessionId}` });
        const cut = selectCut({ sessionId: fromSessionId, messages: source.messages, runs: [...runs.values()].filter((run) => run.sessionId === fromSessionId), throughMessageId });
        const record: SessionRecord & { messages: Message[] } = {
          sessionId,
          agentId: source.agentId,
          ...(source.workspace !== undefined ? { workspace: source.workspace } : {}),
          createdAt: now(),
          updatedAt: now(),
          messages: structuredClone(cut.messages),
        };
        sessions.set(sessionId, record);
        for (const run of cut.runs) {
          const stored = runs.get(runKey(fromSessionId, run.runId)) as StoredRun;
          runs.set(runKey(sessionId, run.runId), {
            ...structuredClone(stripRun(stored)),
            sessionId,
            events: structuredClone(stored.events).map((event) => ({ ...event, sessionId })),
            stepLog: structuredClone(stored.stepLog).map((step) => ({ ...step, sessionId })),
          });
        }
        return stripSession(record);
      },
      async appendMessages({ sessionId, runId, messages }) {
        const s = requireWriter(sessionId, runId);
        s.messages.push(...messages.map((m) => structuredClone(m)));
        s.updatedAt = now();
        // The run's span ends at the last message it appended, so the record a
        // cut reads says where this run ended (p4 fork/rewind).
        const run = runs.get(runKey(sessionId, runId));
        const last = messages.at(-1);
        if (run !== undefined && last !== undefined) {
          run.lastMessageId = last.id;
          run.updatedAt = now();
        }
      },
      async listMessages({ sessionId, limit }) {
        const all = requireSession(sessionId).messages;
        return structuredClone(limit ? all.slice(-limit) : all);
      },
      async claimWriter({ sessionId, runId }) {
        const s = requireSession(sessionId);
        if (s.activeWriterRunId && s.activeWriterRunId !== runId) return false;
        s.activeWriterRunId = runId;
        return true;
      },
      async releaseWriter({ sessionId, runId }) {
        const s = requireSession(sessionId);
        if (s.activeWriterRunId === runId) delete s.activeWriterRunId;
      },
      async heartbeat({ sessionId, runId }) {
        requireWriter(sessionId, runId).updatedAt = now();
      },
    },
    runs: {
      async create(record) {
        requireSession(record.sessionId);
        const key = runKey(record.sessionId, record.runId);
        if (runs.has(key)) throw new StoreError({ code: 'already_exists', message: `run ${record.runId}` });
        runs.set(key, { ...structuredClone(record), events: [], stepLog: [] });
      },
      async get(ref) {
        const r = runs.get(runKey(ref.sessionId, ref.runId));
        return r ? stripRun(r) : undefined;
      },
      async list({ sessionId, status }) {
        requireSession(sessionId);
        return [...runs.values()]
          .filter((r) => r.sessionId === sessionId && (status === undefined || r.status === status))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
          .map(stripRun);
      },
      async update({ sessionId, runId, status, usage, steps, cost, denials, lastMessageId, ...rest }) {
        const r = requireRun({ sessionId, runId });
        r.status = status;
        r.updatedAt = now();
        // Only an explicit `pendingRequestId: undefined` clears it; an absent key leaves it alone.
        if ('pendingRequestId' in rest) {
          if (rest.pendingRequestId === undefined) delete r.pendingRequestId;
          else r.pendingRequestId = rest.pendingRequestId;
        }
        if (usage) r.usage = structuredClone(usage);
        if (steps !== undefined) r.steps = steps;
        if (cost !== undefined) r.cost = cost;
        if (denials !== undefined) r.denials = structuredClone(denials);
        if (lastMessageId !== undefined) r.lastMessageId = lastMessageId;
      },
      async appendEvent(event) {
        const r = requireRun(event);
        const expected = (r.events.at(-1)?.seq ?? 0) + 1;
        if (event.seq !== expected) {
          throw new StoreError({ code: 'seq_gap', message: `run ${event.runId}: expected seq ${expected}, got ${event.seq}` });
        }
        r.events.push(structuredClone(event));
      },
      async listEvents({ sessionId, runId, afterSeq = 0 }) {
        return structuredClone(requireRun({ sessionId, runId }).events.filter((e) => e.seq > afterSeq));
      },
      async appendStep(step) {
        requireRun(step).stepLog.push(structuredClone(step));
      },
      async updateStep({ sessionId, runId, invocationId, patch }) {
        const r = requireRun({ sessionId, runId });
        const i = r.stepLog.findIndex((s) => s.invocationId === invocationId);
        if (i < 0) throw new StoreError({ code: 'not_found', message: `step ${invocationId}` });
        r.stepLog[i] = { ...r.stepLog[i], ...structuredClone(patch) } as StepRecord;
      },
      async listSteps(ref) {
        return structuredClone(requireRun(ref).stepLog);
      },
    },
    requests: {
      async create(request) {
        requireRun(request);
        requests.set(request.requestId, structuredClone(request));
      },
      async get({ sessionId, runId, requestId }) {
        const r = requests.get(requestId);
        return r && r.sessionId === sessionId && r.runId === runId ? structuredClone(r) : undefined;
      },
      async resolve({ sessionId, runId, requestId, resolution }) {
        const r = requests.get(requestId);
        if (!r || r.sessionId !== sessionId || r.runId !== runId) {
          throw new StoreError({ code: 'not_found', message: `request ${requestId} in run ${runId}` });
        }
        r.resolution = structuredClone(resolution);
        r.resolvedAt = now();
      },
    },
    kv(scope) {
      const scopeKey =
        scope.kind === 'agent' ? `agent:${scope.agentId}`
        : scope.kind === 'shared' ? `shared:${scope.namespace}`
        : `workspace:${scope.workspace}`;
      let entries = scopes.get(scopeKey);
      if (!entries) {
        entries = new Map();
        scopes.set(scopeKey, entries);
      }
      const map = entries;
      return {
        async get<T = unknown>(key: string) { return structuredClone(map.get(key)) as T | undefined; },
        async set(key, value) { map.set(key, structuredClone(value)); },
        async delete(key) { map.delete(key); },
        async list(prefix = '') { return [...map.keys()].filter((k) => k.startsWith(prefix)); },
      } satisfies KvScope;
    },
  };

  function stripRun(r: RunRecord & { events: unknown; stepLog: unknown }): RunRecord {
    const { events: _e, stepLog: _s, ...rest } = r;
    return structuredClone(rest);
  }
  function stripSession(s: SessionRecord & { messages: unknown }): SessionRecord {
    const { messages: _m, ...rest } = s;
    return structuredClone(rest);
  }
}
