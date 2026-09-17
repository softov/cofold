import { appendFile, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAgent, createTool, resume, run } from '@facio/agents';
import type { RunRecord, Store } from '@facio/agents';
import { createFakeModel } from '@facio/agents/testing';
import { describeStoreConformance } from '@facio/agents/testing/store-conformance';
import { encodeSegment } from './paths.js';
import { workspaceSlug } from './slug.js';
import { createFileStore } from './store.js';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'facio-store-'));
  roots.push(root);
  return root;
}
afterAll(async () => { for (const r of roots) await rm(r, { recursive: true, force: true }); });

describeStoreConformance({ name: 'file', create: async () => createFileStore({ root: await tempRoot() }) });

const runRecord = (sessionId: string, runId: string, over: Partial<RunRecord> = {}): RunRecord => ({
  runId, sessionId, agentId: 'a', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  usage: { inputTokens: 0, outputTokens: 0 }, steps: 0, denials: [], ...over,
});
const exists = (p: string) => stat(p).then(() => true, () => false);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; }
  catch (e) { return (e as { code?: string }).code; }
}

describe('createFileStore layout', () => {
  it('nests a workspace session under workspaces/<slug>/ and finds it without the workspace', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    await store.sessions.create({ sessionId: 'ws/1', agentId: 'a', workspace: 'F:/some dir/proj' });
    await store.sessions.create({ sessionId: 'plain', agentId: 'a' });
    const slug = workspaceSlug({ workspace: 'F:/some dir/proj' });
    expect(await exists(join(root, 'workspaces', slug, 'sessions', encodeSegment('ws/1'), 'session.json'))).toBe(true);
    expect(await exists(join(root, 'sessions', 'plain', 'session.json'))).toBe(true);
    // a fresh store instance has no cache and must scan
    const other = createFileStore({ root });
    expect(await other.sessions.get({ sessionId: 'ws/1' })).toMatchObject({ workspace: 'F:/some dir/proj' });
    expect((await other.sessions.list({ workspace: 'F:/some dir/proj' })).map((s) => s.sessionId)).toEqual(['ws/1']);
    expect(await codeOf(other.sessions.create({ sessionId: 'ws/1', agentId: 'b' }))).toBe('already_exists');
  });

  it('writes writer.lock on claim and removes it on release; heartbeat refreshes it', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    const file = join(root, 'sessions', 's', 'writer.lock');
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r' })).toBe(true);
    const lock = JSON.parse(await readFile(file, 'utf8'));
    expect(lock).toMatchObject({ runId: 'r', pid: process.pid, claimedAt: expect.any(String), heartbeatAt: lock.claimedAt });
    await new Promise((r) => setTimeout(r, 2));
    await store.sessions.heartbeat({ sessionId: 's', runId: 'r' });
    const after = JSON.parse(await readFile(file, 'utf8'));
    expect(after.heartbeatAt > lock.heartbeatAt).toBe(true);
    expect(after.claimedAt).toBe(lock.claimedAt);
    await store.sessions.releaseWriter({ sessionId: 's', runId: 'other' });
    expect(await exists(file)).toBe(true);
    await store.sessions.releaseWriter({ sessionId: 's', runId: 'r' });
    expect(await exists(file)).toBe(false);
  });

  it('takes over a stale lock only when its run is still running', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root, staleAfterMs: 60_000 });
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'dead', { status: 'running' }));
    await store.runs.create(runRecord('s', 'paused', { status: 'awaiting' }));
    const file = join(root, 'sessions', 's', 'writer.lock');
    const old = new Date(Date.now() - 120_000).toISOString();

    await writeFile(file, JSON.stringify({ runId: 'dead', pid: 1, claimedAt: old, heartbeatAt: old }));
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'new' })).toBe(true);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ runId: 'new', pid: process.pid });
    await store.sessions.releaseWriter({ sessionId: 's', runId: 'new' });

    await writeFile(file, JSON.stringify({ runId: 'paused', pid: 1, claimedAt: old, heartbeatAt: old }));
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'new' })).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8')).runId).toBe('paused');

    const fresh = new Date().toISOString();
    await writeFile(file, JSON.stringify({ runId: 'dead', pid: 1, claimedAt: fresh, heartbeatAt: fresh }));
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'new' })).toBe(false);
  });

  it('fences a run whose lock another process took over', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
    const file = join(root, 'sessions', 's', 'writer.lock');
    const mine = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...mine, pid: process.pid + 1 }));
    expect(await codeOf(store.sessions.heartbeat({ sessionId: 's', runId: 'r' }))).toBe('writer_mismatch');
    expect(await codeOf(store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [] }))).toBe('writer_mismatch');
    expect(await codeOf(store.runs.update({ sessionId: 's', runId: 'r', status: 'failed' }))).toBe('writer_mismatch');
    expect(await codeOf(store.runs.appendStep({ kind: 'model', sessionId: 's', runId: 'r', index: 0, invocationId: 'i', status: 'started', startedAt: 'now' }))).toBe('writer_mismatch');
    await store.sessions.releaseWriter({ sessionId: 's', runId: 'r' });
    expect(await exists(file)).toBe(true);
    // the same run from "another process" re-claims its own lock and stamps its pid
    expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r' })).toBe(true);
    expect(JSON.parse(await readFile(file, 'utf8')).pid).toBe(process.pid);
  });

  it('survives a torn last line in events.jsonl and continues the seq after it', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    const ev = (seq: number) => ({ seq, runId: 'r', sessionId: 's', agentId: 'a', at: 'now', type: 'model.started' as const, step: seq });
    await store.runs.appendEvent(ev(1));
    await store.runs.appendEvent(ev(2));
    await appendFile(join(root, 'sessions', 's', 'runs', 'r', 'events.jsonl'), '{"seq":3,"runId":"r","sess');
    const fresh = createFileStore({ root });
    expect((await fresh.runs.listEvents({ sessionId: 's', runId: 'r' })).map((e) => e.seq)).toEqual([1, 2]);
    expect(await codeOf(fresh.runs.appendEvent(ev(4)))).toBe('seq_gap');
    await fresh.runs.appendEvent(ev(3));
    expect((await fresh.runs.listEvents({ sessionId: 's', runId: 'r' })).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('folds steps.jsonl by invocationId and caps oversized detail', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create(runRecord('s', 'r'));
    await store.runs.appendStep({ kind: 'tool', sessionId: 's', runId: 'r', index: 0, invocationId: 'i1', status: 'started', callId: 'c', name: 'echo', input: {}, startedAt: 'now' });
    await store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'i1', patch: { status: 'completed', original: { content: 'ok', isError: false, detail: { big: 'x'.repeat(300_000) } }, endedAt: 'later' } });
    await store.runs.appendStep({ kind: 'model', sessionId: 's', runId: 'r', index: 1, invocationId: 'i2', status: 'started', startedAt: 'now', detail: { small: true } });
    const lines = (await readFile(join(root, 'sessions', 's', 'runs', 'r', 'steps.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(3);
    const steps = await store.runs.listSteps({ sessionId: 's', runId: 'r' });
    expect(steps.map((s) => s.invocationId)).toEqual(['i1', 'i2']);
    expect(steps[0]).toMatchObject({ status: 'completed', endedAt: 'later', original: { content: 'ok', detail: { truncated: true, bytes: expect.any(Number) } } });
    expect((steps[0] as { original: { detail: { bytes: number } } }).original.detail.bytes).toBeGreaterThan(300_000);
    expect(steps[1]).toMatchObject({ kind: 'model', detail: { small: true } });
  });

  it('encodes kv keys and refuses one longer than 200 bytes', async () => {
    const root = await tempRoot();
    const store = createFileStore({ root });
    const kv = store.kv({ kind: 'shared', namespace: 'team/x' });
    await kv.set('a b/c:d', { v: 1 });
    expect(await exists(join(root, 'kv', 'shared', 'team%2Fx', 'a%20b%2Fc%3Ad.json'))).toBe(true);
    expect(await kv.get('a b/c:d')).toEqual({ v: 1 });
    expect(await kv.list()).toEqual(['a b/c:d']);
    expect(await codeOf(kv.set('k'.repeat(300), 1))).toBe('invalid_options');
    expect(await codeOf(store.sessions.create({ sessionId: 'x'.repeat(201), agentId: 'a' }))).toBe('invalid_options');
  });
});

describe('createFileStore end to end', () => {
  it('a session folder copied to another root resumes there: pause, approve, tool executed once', async () => {
    const rootA = await tempRoot();
    const rootB = await tempRoot();
    let executions = 0;
    const rm = createTool<{ path: string }>({
      name: 'delete_file', description: 'delete', effects: { destructive: true },
      input: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      execute: (i) => { executions += 1; return `deleted ${i.path}`; },
    });
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a.txt' } }] }, { text: 'gone' }] });
    const agentA = createAgent({ id: 'a', instructions: 'x', model, tools: [rm], store: createFileStore({ root: rootA }) });
    const first = run({ agent: agentA, session: 'sess', workspace: 'F:/proj', input: 'delete a.txt' });
    const paused = await first.outcome;
    expect(paused.status).toBe('awaiting');
    const requestId = paused.status === 'awaiting' ? paused.requestId : '';

    // "the process dies": everything the second process has is the folder
    await cp(rootA, rootB, { recursive: true });
    const storeB: Store = createFileStore({ root: rootB });
    const agentB = createAgent({ id: 'a', instructions: 'x', model, tools: [rm], store: storeB });
    const handle = resume({ agent: agentB, sessionId: 'sess', runId: first.runId });
    const seqs: number[] = [];
    const eventsP = (async () => { for await (const e of handle.events) seqs.push(e.seq); })();
    await handle.submit({ type: 'approve', requestId });
    await eventsP;
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('completed');
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(executions).toBe(1);

    const steps = await storeB.runs.listSteps({ sessionId: 'sess', runId: first.runId });
    expect(steps.filter((s) => s.kind === 'tool')).toHaveLength(1);
    expect(steps[1]).toMatchObject({ kind: 'tool', status: 'completed', original: { content: 'deleted a.txt' } });
    expect(await storeB.runs.get({ sessionId: 'sess', runId: first.runId })).toMatchObject({ status: 'completed', steps: 2 });
    expect((await storeB.sessions.get({ sessionId: 'sess' }))?.activeWriterRunId).toBeUndefined();
    expect((await storeB.runs.list({ sessionId: 'sess', status: 'completed' })).map((r) => r.runId)).toEqual([first.runId]);
    // root A is untouched: still awaiting with its claim
    const storeA = createFileStore({ root: rootA });
    expect(await storeA.runs.get({ sessionId: 'sess', runId: first.runId })).toMatchObject({ status: 'awaiting', pendingRequestId: requestId });
    expect((await storeA.sessions.get({ sessionId: 'sess' }))?.activeWriterRunId).toBe(first.runId);
  });
});
