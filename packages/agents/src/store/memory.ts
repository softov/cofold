import { StoreError } from '../errors.js';
import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { KvScope, PendingRequest, RunRecord, RunRef, SessionRecord, StepRecord, Store } from '../types/store.js';

export function createMemoryStore(): Store {
  const sessions = new Map<string, SessionRecord & { messages: Message[] }>();
  const runs = new Map<string, RunRecord & { events: RunEvent[]; steps: StepRecord[] }>();
  const requests = new Map<string, PendingRequest>();
  /** One entry map per kv scope, keyed "agent:<agentId>", "shared:<namespace>" or "workspace:<workspace>". */
  const scopes = new Map<string, Map<string, unknown>>();
  const now = () => new Date().toISOString();

  /** Runs are keyed by runId here; the sessionId check mirrors the file store, which can only find a run through its session. */
  const requireRun = (ref: RunRef) => {
    const run = runs.get(ref.runId);
    if (!run || run.sessionId !== ref.sessionId) {
      throw new StoreError({ code: 'not_found', message: `run ${ref.runId} in session ${ref.sessionId}` });
    }
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

  return {
    sessions: {
      async get({ sessionId }) {
        const s = sessions.get(sessionId);
        return s ? stripSession(s) : undefined;
      },
      async create({ sessionId, agentId, workspace }) {
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
      async appendMessages({ sessionId, runId, messages }) {
        const s = requireWriter(sessionId, runId);
        s.messages.push(...messages.map((m) => structuredClone(m)));
        s.updatedAt = now();
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
    },
    runs: {
      async create(record) {
        requireSession(record.sessionId);
        runs.set(record.runId, { ...structuredClone(record), events: [], steps: [] });
      },
      async get(ref) {
        const r = runs.get(ref.runId);
        return r && r.sessionId === ref.sessionId ? stripRun(r) : undefined;
      },
      async update({ sessionId, runId, status, pendingRequestId }) {
        const r = requireRun({ sessionId, runId });
        r.status = status;
        r.updatedAt = now();
        if (pendingRequestId === undefined) delete r.pendingRequestId;
        else r.pendingRequestId = pendingRequestId;
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
        requireRun(step).steps.push(structuredClone(step));
      },
      async updateStep({ sessionId, runId, invocationId, patch }) {
        const r = requireRun({ sessionId, runId });
        const i = r.steps.findIndex((s) => s.invocationId === invocationId);
        if (i < 0) throw new StoreError({ code: 'not_found', message: `step ${invocationId}` });
        r.steps[i] = { ...r.steps[i], ...structuredClone(patch) } as StepRecord;
      },
      async listSteps(ref) {
        return structuredClone(requireRun(ref).steps);
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

  function stripRun(r: RunRecord & { events: unknown; steps: unknown }): RunRecord {
    const { events: _e, steps: _s, ...rest } = r;
    return structuredClone(rest);
  }
  function stripSession(s: SessionRecord & { messages: unknown }): SessionRecord {
    const { messages: _m, ...rest } = s;
    return structuredClone(rest);
  }
}
