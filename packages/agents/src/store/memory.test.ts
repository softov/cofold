import { describe, expect, it } from 'vitest';
import { StoreError } from '../errors.js';
import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { RunRecord } from '../types/store.js';
import { createMemoryStore } from './memory.js';

const msg = (text: string): Message => ({ id: text, role: 'user', source: 'input', createdAt: '2026-01-01T00:00:00.000Z', parts: [{ type: 'text', text }] });
const runRecord = (sessionId: string, runId: string): RunRecord => ({
  runId,
  sessionId,
  agentId: 'a',
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const event = (sessionId: string, runId: string, seq: number): RunEvent => ({ seq, runId, sessionId, agentId: 'a', at: 'now', type: 'model.started', step: seq });

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    return (e as StoreError).code;
  }
}

describe('createMemoryStore sessions', () => {
  it('fences appendMessages behind the writer claim', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    expect(await codeOf(store.sessions.appendMessages({ sessionId: 's', runId: 'r1', messages: [msg('x')] }))).toBe('writer_mismatch');

    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' })).toBe(true);
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r2' })).toBe(false);
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' })).toBe(true);
    await store.sessions.appendMessages({ sessionId: 's', runId: 'r1', messages: [msg('x')] });
    expect(await codeOf(store.sessions.appendMessages({ sessionId: 's', runId: 'r2', messages: [msg('y')] }))).toBe('writer_mismatch');

    await store.sessions.releaseWriter({ sessionId: 's', runId: 'r1' });
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r2' })).toBe(true);
    await store.sessions.appendMessages({ sessionId: 's', runId: 'r2', messages: [msg('y')] });
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id)).toEqual(['x', 'y']);
    expect((await store.sessions.listMessages({ sessionId: 's', limit: 1 })).map((m) => m.id)).toEqual(['y']);
  });

  it('stores no workspace key when none is given and never exposes messages', async () => {
    const store = createMemoryStore();
    const created = await store.sessions.create({ sessionId: 's', agentId: 'a' });
    expect('workspace' in created).toBe(false);
    expect('messages' in created).toBe(false);
    const got = await store.sessions.get({ sessionId: 's' });
    expect(got).toBeDefined();
    expect('messages' in got!).toBe(false);
    expect(await store.sessions.get({ sessionId: 'missing' })).toBeUndefined();
    expect(await codeOf(store.sessions.listMessages({ sessionId: 'missing' }))).toBe('not_found');
  });

  it('refuses to create a session twice', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
    await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('x')] });
    expect(await codeOf(store.sessions.create({ sessionId: 's', agentId: 'b' }))).toBe('already_exists');
    expect(await store.sessions.listMessages({ sessionId: 's' })).toHaveLength(1);
    expect((await store.sessions.get({ sessionId: 's' }))?.agentId).toBe('a');
  });

  it('lists by workspace and agent, newest updatedAt first', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's1', agentId: 'a', workspace: 'a' });
    await store.sessions.create({ sessionId: 's2', agentId: 'b', workspace: 'a' });
    await store.sessions.create({ sessionId: 's3', agentId: 'a', workspace: 'b' });
    await store.sessions.create({ sessionId: 's4', agentId: 'a' });
    // bump s1 so it is the newest
    await new Promise((r) => setTimeout(r, 2));
    await store.sessions.claimWriter({ sessionId: 's1', runId: 'r' });
    await store.sessions.appendMessages({ sessionId: 's1', runId: 'r', messages: [msg('x')] });

    expect((await store.sessions.list({ workspace: 'a' })).map((s) => s.sessionId)).toEqual(['s1', 's2']);
    expect((await store.sessions.list({ workspace: 'a', agentId: 'a' })).map((s) => s.sessionId)).toEqual(['s1']);
    expect((await store.sessions.list({ agentId: 'a' })).map((s) => s.sessionId)).toEqual(['s1', 's3', 's4']);
    expect((await store.sessions.list({ limit: 1 })).map((s) => s.sessionId)).toEqual(['s1']);
    for (const s of await store.sessions.list({})) expect('messages' in s).toBe(false);
  });
});

describe('createMemoryStore runs', () => {
  it('enforces contiguous event seq and filters by afterSeq', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.runs.appendEvent(event('s', 'r', 1));
    expect(await codeOf(store.runs.appendEvent(event('s', 'r', 3)))).toBe('seq_gap');
    expect(await codeOf(store.runs.appendEvent(event('s', 'r', 1)))).toBe('seq_gap');
    await store.runs.appendEvent(event('s', 'r', 2));
    await store.runs.appendEvent(event('s', 'r', 3));
    expect((await store.runs.listEvents({ sessionId: 's', runId: 'r', afterSeq: 1 })).map((e) => e.seq)).toEqual([2, 3]);
    expect((await store.runs.listEvents({ sessionId: 's', runId: 'r' })).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('rejects run-level calls whose sessionId does not own the run', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.sessions.create({ sessionId: 'other', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    expect(await store.runs.get({ sessionId: 'other', runId: 'r' })).toBeUndefined();
    expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toMatchObject({ runId: 'r', status: 'running' });
    expect(await codeOf(store.runs.update({ sessionId: 'other', runId: 'r', status: 'completed' }))).toBe('not_found');
    expect(await codeOf(store.runs.appendEvent(event('other', 'r', 1)))).toBe('not_found');
    expect(await codeOf(store.runs.listSteps({ sessionId: 'other', runId: 'r' }))).toBe('not_found');
    expect(await codeOf(store.runs.create(runRecord('missing', 'r2')))).toBe('not_found');
  });

  it('refuses to create a run twice', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.runs.appendEvent(event('s', 'r', 1));
    expect(await codeOf(store.runs.create({ ...runRecord('s', 'r'), status: 'failed' }))).toBe('already_exists');
    expect(await store.runs.listEvents({ sessionId: 's', runId: 'r' })).toHaveLength(1);
    expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.status).toBe('running');
  });

  it('updates status and pendingRequestId, and steps by invocationId', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.runs.update({ sessionId: 's', runId: 'r', status: 'awaiting', pendingRequestId: 'q' });
    expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toMatchObject({ status: 'awaiting', pendingRequestId: 'q' });
    await store.runs.update({ sessionId: 's', runId: 'r', status: 'running' });
    const run = await store.runs.get({ sessionId: 's', runId: 'r' });
    expect('pendingRequestId' in run!).toBe(false);
    expect('events' in run!).toBe(false);

    await store.runs.appendStep({ kind: 'tool', sessionId: 's', runId: 'r', index: 0, invocationId: 'i1', status: 'started', callId: 'c', name: 'echo', input: {}, startedAt: 'now' });
    await store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'i1', patch: { status: 'completed', endedAt: 'later' } });
    expect(await store.runs.listSteps({ sessionId: 's', runId: 'r' })).toMatchObject([{ invocationId: 'i1', status: 'completed', endedAt: 'later' }]);
    expect(await codeOf(store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'nope', patch: {} }))).toBe('not_found');
  });

  it('returns clones from get, listEvents and listMessages', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
    await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('x')] });
    await store.runs.create(runRecord('s', 'r'));

    const [m] = await store.sessions.listMessages({ sessionId: 's' });
    m!.parts.push({ type: 'text', text: 'mutated' });
    expect((await store.sessions.listMessages({ sessionId: 's' }))[0]!.parts).toHaveLength(1);

    const r1 = await store.runs.get({ sessionId: 's', runId: 'r' });
    r1!.status = 'failed';
    expect((await store.runs.get({ sessionId: 's', runId: 'r' }))!.status).toBe('running');
  });
});

describe('createMemoryStore requests', () => {
  it('creates, reads and resolves under the owning run', async () => {
    const store = createMemoryStore();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.requests.create({ requestId: 'q', sessionId: 's', runId: 'r', kind: 'approval', callId: 'c', payload: { name: 'rm' }, createdAt: 'now' });
    expect(await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'q' })).toMatchObject({ kind: 'approval', callId: 'c' });
    expect(await store.requests.get({ sessionId: 's', runId: 'other', requestId: 'q' })).toBeUndefined();
    expect(await codeOf(store.requests.resolve({ sessionId: 's', runId: 'other', requestId: 'q', resolution: 'approve' }))).toBe('not_found');
    await store.requests.resolve({ sessionId: 's', runId: 'r', requestId: 'q', resolution: { decision: 'approve' } });
    const got = await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'q' });
    expect(got?.resolution).toEqual({ decision: 'approve' });
    expect(typeof got?.resolvedAt).toBe('string');
  });
});

describe('createMemoryStore kv', () => {
  it('isolates agent, shared and workspace scopes, and shares entries per scope', async () => {
    const store = createMemoryStore();
    const agent = store.kv({ kind: 'agent', agentId: 'a' });
    const shared = store.kv({ kind: 'shared', namespace: 'a' });
    const workspace = store.kv({ kind: 'workspace', workspace: 'a' });
    await agent.set('k', 1);
    await shared.set('k', 2);
    await workspace.set('k', 3);
    expect(await agent.get('k')).toBe(1);
    expect(await shared.get('k')).toBe(2);
    expect(await workspace.get('k')).toBe(3);
    expect(await store.kv({ kind: 'agent', agentId: 'a' }).get('k')).toBe(1);
    expect(await store.kv({ kind: 'agent', agentId: 'b' }).get('k')).toBeUndefined();
    await agent.set('k2', 1);
    expect(await agent.list()).toEqual(['k', 'k2']);
    expect(await agent.list('k2')).toEqual(['k2']);
    await agent.delete('k');
    expect(await agent.list()).toEqual(['k2']);
  });

  it('clones values on write and on read', async () => {
    const store = createMemoryStore();
    const kv = store.kv({ kind: 'shared', namespace: 'n' });
    const value = { list: [1] };
    await kv.set('k', value);
    value.list.push(2);
    const a = await kv.get<{ list: number[] }>('k');
    expect(a).toEqual({ list: [1] });
    a!.list.push(3);
    expect(await kv.get('k')).toEqual({ list: [1] });
  });
});
