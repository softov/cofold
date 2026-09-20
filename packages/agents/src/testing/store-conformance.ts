import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { RunRecord, Store } from '../types/store.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreError } from '../errors.js';

const msg = (text: string): Message => ({ id: text, role: 'user', source: 'input', createdAt: '2026-01-01T00:00:00.000Z', parts: [{ type: 'text', text }] });
const runRecord = (sessionId: string, runId: string, over: Partial<RunRecord> = {}): RunRecord => ({
  runId,
  sessionId,
  agentId: 'a',
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  usage: { inputTokens: 0, outputTokens: 0 },
  steps: 0,
  denials: [],
  ...over,
});
const event = (sessionId: string, runId: string, seq: number): RunEvent => ({ seq, runId, sessionId, agentId: 'a', at: 'now', type: 'model.started', step: seq });

/**
 * A session with three completed turns and one never-terminal run: messages m1..m5, r1 (m1-m2) and
 * r2 (m3-m4) completed with a log, r3 (m5) completed, r4 (m1-m2) still `running`, and requests on
 * r1 and r3. A cut at m4 keeps r1 and r2 and drops r3 and r4.
 */
async function seedCut(store: Store): Promise<void> {
  await store.sessions.create({ sessionId: 's', agentId: 'a', workspace: 'w' });
  await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' });
  await store.sessions.appendMessages({ sessionId: 's', runId: 'r1', messages: [msg('m1'), msg('m2')] });
  await store.runs.create(runRecord('s', 'r1', { status: 'completed', inputMessageId: 'm1', lastMessageId: 'm2', usage: { inputTokens: 11, outputTokens: 12 }, steps: 2 }));
  await store.runs.appendEvent(event('s', 'r1', 1));
  await store.runs.appendStep({ kind: 'model', sessionId: 's', runId: 'r1', index: 0, invocationId: 'i1', status: 'completed', startedAt: 'now' });
  await store.requests.create({ requestId: 'q1', sessionId: 's', runId: 'r1', kind: 'approval', callId: 'c1', payload: { name: 'rm' }, createdAt: 'now' });
  await store.sessions.releaseWriter({ sessionId: 's', runId: 'r1' });
  await store.sessions.claimWriter({ sessionId: 's', runId: 'r2' });
  await store.sessions.appendMessages({ sessionId: 's', runId: 'r2', messages: [msg('m3'), msg('m4')] });
  await store.runs.create(runRecord('s', 'r2', { status: 'completed', inputMessageId: 'm3', lastMessageId: 'm4' }));
  await store.runs.appendStep({ kind: 'tool', sessionId: 's', runId: 'r2', index: 0, invocationId: 'i2', status: 'completed', callId: 'c2', name: 'echo', input: {}, startedAt: 'now' });
  await store.sessions.releaseWriter({ sessionId: 's', runId: 'r2' });
  await store.sessions.claimWriter({ sessionId: 's', runId: 'r3' });
  await store.sessions.appendMessages({ sessionId: 's', runId: 'r3', messages: [msg('m5')] });
  await store.runs.create(runRecord('s', 'r3', { status: 'completed', inputMessageId: 'm5', lastMessageId: 'm5' }));
  await store.requests.create({ requestId: 'q3', sessionId: 's', runId: 'r3', kind: 'approval', callId: 'c3', payload: { name: 'rm' }, createdAt: 'now' });
  await store.sessions.releaseWriter({ sessionId: 's', runId: 'r3' });
  // Never terminal, over r1's span, and not the claim holder: a cut never keeps it.
  await store.runs.create(runRecord('s', 'r4', { status: 'running', inputMessageId: 'm1', lastMessageId: 'm2' }));
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    return (e as StoreError).code;
  }
}

/**
 * Every behavior a Store must have (decision 84). Call it from a test file; `create` runs before each case.
 * Store-specific tests (file layout, lock staleness) live next to the store, never here.
 * Published as `@facio/agents/testing/store-conformance`, apart from `./testing`: this module imports vitest,
 * which throws when loaded outside a vitest run.
 */
export function describeStoreConformance(args: { name: string; create: () => Store | Promise<Store>; dispose?: (store: Store) => Promise<void> | void }): void {
  describe(`Store conformance: ${args.name}`, () => {
    let store: Store;
    beforeEach(async () => { store = await args.create(); });
    afterEach(async () => { await args.dispose?.(store); });

    describe('sessions', () => {
      it('fences appendMessages behind the writer claim', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        expect(await codeOf(store.sessions.appendMessages({ sessionId: 's', runId: 'r1', messages: [msg('x')] }))).toBe('writer_mismatch');

        expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' })).toBe(true);
        expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r2' })).toBe(false);
        expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' })).toBe(true);
        expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBe('r1');
        await store.sessions.appendMessages({ sessionId: 's', runId: 'r1', messages: [msg('x')] });
        expect(await codeOf(store.sessions.appendMessages({ sessionId: 's', runId: 'r2', messages: [msg('y')] }))).toBe('writer_mismatch');

        await store.sessions.releaseWriter({ sessionId: 's', runId: 'r1' });
        expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
        expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'r2' })).toBe(true);
        await store.sessions.appendMessages({ sessionId: 's', runId: 'r2', messages: [msg('y')] });
        expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id)).toEqual(['x', 'y']);
        expect((await store.sessions.listMessages({ sessionId: 's', limit: 1 })).map((m) => m.id)).toEqual(['y']);
      });

      it('advances the run\'s lastMessageId with every message it appends', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r', { inputMessageId: 'm1' }));
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.lastMessageId).toBeUndefined();

        await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('m1')] });
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.lastMessageId).toBe('m1');
        await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('m2'), msg('m3')] });
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.lastMessageId).toBe('m3');

        // A session with no record for the run still takes the messages.
        await store.sessions.releaseWriter({ sessionId: 's', runId: 'r' });
        await store.sessions.claimWriter({ sessionId: 's', runId: 'loose' });
        await store.sessions.appendMessages({ sessionId: 's', runId: 'loose', messages: [msg('m4')] });
        expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
      });

      it('stores no workspace key when none is given and never exposes messages', async () => {
        const created = await store.sessions.create({ sessionId: 's', agentId: 'a' });
        expect('workspace' in created).toBe(false);
        expect('messages' in created).toBe(false);
        const got = await store.sessions.get({ sessionId: 's' });
        expect(got).toBeDefined();
        expect('messages' in got!).toBe(false);
        expect(await store.sessions.get({ sessionId: 'missing' })).toBeUndefined();
        expect(await codeOf(store.sessions.listMessages({ sessionId: 'missing' }))).toBe('not_found');
      });

      it('keeps the workspace on the record', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a', workspace: 'F:/x' });
        expect(await store.sessions.get({ sessionId: 's' })).toMatchObject({ sessionId: 's', agentId: 'a', workspace: 'F:/x' });
      });

      it('refuses to create a session twice', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
        await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('x')] });
        expect(await codeOf(store.sessions.create({ sessionId: 's', agentId: 'b' }))).toBe('already_exists');
        expect(await store.sessions.listMessages({ sessionId: 's' })).toHaveLength(1);
        expect((await store.sessions.get({ sessionId: 's' }))?.agentId).toBe('a');
      });

      it('lists by workspace and agent, newest updatedAt first', async () => {
        // A tick between writes so every updatedAt differs: s1 < s2 < s3 < s4, then s1 is bumped to newest.
        const tick = () => new Promise((r) => setTimeout(r, 2));
        await store.sessions.create({ sessionId: 's1', agentId: 'a', workspace: 'a' });
        await tick();
        await store.sessions.create({ sessionId: 's2', agentId: 'b', workspace: 'a' });
        await tick();
        await store.sessions.create({ sessionId: 's3', agentId: 'a', workspace: 'b' });
        await tick();
        await store.sessions.create({ sessionId: 's4', agentId: 'a' });
        await tick();
        await store.sessions.claimWriter({ sessionId: 's1', runId: 'r' });
        await store.sessions.appendMessages({ sessionId: 's1', runId: 'r', messages: [msg('x')] });

        expect((await store.sessions.list({ workspace: 'a' })).map((s) => s.sessionId)).toEqual(['s1', 's2']);
        expect((await store.sessions.list({ workspace: 'a', agentId: 'a' })).map((s) => s.sessionId)).toEqual(['s1']);
        expect((await store.sessions.list({ agentId: 'a' })).map((s) => s.sessionId)).toEqual(['s1', 's4', 's3']);
        expect((await store.sessions.list({ limit: 1 })).map((s) => s.sessionId)).toEqual(['s1']);
        for (const s of await store.sessions.list({})) expect('messages' in s).toBe(false);
      });

      it('deletes a session with everything under it, unless a run is writing', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a', workspace: 'w' });
        await store.sessions.create({ sessionId: 'kept', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.requests.create({ requestId: 'q', sessionId: 's', runId: 'r', kind: 'approval', callId: 'c', payload: { name: 'rm' }, createdAt: 'now' });
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
        expect(await codeOf(store.sessions.delete({ sessionId: 's' }))).toBe('writer_busy');
        // Paused: the claim is held, nothing is being written, the session may go.
        await store.runs.update({ sessionId: 's', runId: 'r', status: 'awaiting', pendingRequestId: 'q' });
        await store.sessions.delete({ sessionId: 's' });
        expect(await store.sessions.get({ sessionId: 's' })).toBeUndefined();
        expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toBeUndefined();
        expect(await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'q' })).toBeUndefined();
        expect(await codeOf(store.sessions.delete({ sessionId: 's' }))).toBe('not_found');
        expect(await codeOf(store.sessions.listMessages({ sessionId: 's' }))).toBe('not_found');
        expect((await store.sessions.list({})).map((one) => one.sessionId)).toEqual(['kept']);
      });

      it('heartbeat requires the writer claim', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        expect(await codeOf(store.sessions.heartbeat({ sessionId: 's', runId: 'r' }))).toBe('writer_mismatch');
        expect(await codeOf(store.sessions.heartbeat({ sessionId: 'missing', runId: 'r' }))).toBe('not_found');
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
        await store.sessions.heartbeat({ sessionId: 's', runId: 'r' });
        expect(await codeOf(store.sessions.heartbeat({ sessionId: 's', runId: 'other' }))).toBe('writer_mismatch');
        await store.sessions.releaseWriter({ sessionId: 's', runId: 'r' });
        expect(await codeOf(store.sessions.heartbeat({ sessionId: 's', runId: 'r' }))).toBe('writer_mismatch');
      });
    });

    describe('runs', () => {
      it('enforces contiguous event seq and filters by afterSeq', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.runs.appendEvent(event('s', 'r', 1));
        expect(await codeOf(store.runs.appendEvent(event('s', 'r', 3)))).toBe('seq_gap');
        expect(await codeOf(store.runs.appendEvent(event('s', 'r', 1)))).toBe('seq_gap');
        await store.runs.appendEvent(event('s', 'r', 2));
        await store.runs.appendEvent(event('s', 'r', 3));
        expect((await store.runs.listEvents({ sessionId: 's', runId: 'r', afterSeq: 1 })).map((e) => e.seq)).toEqual([2, 3]);
        expect((await store.runs.listEvents({ sessionId: 's', runId: 'r' })).map((e) => e.seq)).toEqual([1, 2, 3]);
        expect((await store.runs.listEvents({ sessionId: 's', runId: 'r' }))[0]).toEqual(event('s', 'r', 1));
      });

      it('rejects run-level calls whose sessionId does not own the run', async () => {
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
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.runs.appendEvent(event('s', 'r', 1));
        expect(await codeOf(store.runs.create({ ...runRecord('s', 'r'), status: 'failed' }))).toBe('already_exists');
        expect(await store.runs.listEvents({ sessionId: 's', runId: 'r' })).toHaveLength(1);
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.status).toBe('running');
      });

      it('round-trips the whole record', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        const record = runRecord('s', 'r', { inputMessageId: 'm1', usage: { inputTokens: 3, outputTokens: 4, cacheReadTokens: 1 }, steps: 2 });
        await store.runs.create(record);
        expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toEqual(record);
      });

      it('updates status, counters and pendingRequestId (cleared only when passed explicitly)', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.runs.update({ sessionId: 's', runId: 'r', status: 'awaiting', pendingRequestId: 'q', usage: { inputTokens: 5, outputTokens: 6 }, steps: 3 });
        expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toMatchObject({ status: 'awaiting', pendingRequestId: 'q', usage: { inputTokens: 5, outputTokens: 6 }, steps: 3 });

        await store.runs.update({ sessionId: 's', runId: 'r', status: 'running' });
        let run = await store.runs.get({ sessionId: 's', runId: 'r' });
        expect(run).toMatchObject({ status: 'running', pendingRequestId: 'q', usage: { inputTokens: 5, outputTokens: 6 }, steps: 3 });
        expect('events' in run!).toBe(false);

        await store.runs.update({ sessionId: 's', runId: 'r', status: 'running', pendingRequestId: undefined, lastMessageId: 'm9' });
        run = await store.runs.get({ sessionId: 's', runId: 'r' });
        expect('pendingRequestId' in run!).toBe(false);
        expect(run?.lastMessageId).toBe('m9');
        expect(run!.updatedAt > run!.createdAt).toBe(true);
      });

      it('persists cost only when it is given (decision 109): absent means unknown, never zero', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        let run = await store.runs.get({ sessionId: 's', runId: 'r' });
        expect('cost' in run!).toBe(false);

        await store.runs.update({ sessionId: 's', runId: 'r', status: 'running', usage: { inputTokens: 5, outputTokens: 6 }, steps: 1 });
        run = await store.runs.get({ sessionId: 's', runId: 'r' });
        expect('cost' in run!).toBe(false);

        await store.runs.update({ sessionId: 's', runId: 'r', status: 'completed', cost: 0.0123 });
        run = await store.runs.get({ sessionId: 's', runId: 'r' });
        expect(run).toMatchObject({ status: 'completed', cost: 0.0123, usage: { inputTokens: 5, outputTokens: 6 }, steps: 1 });

        const created = runRecord('s', 'r2', { cost: 0.5 });
        await store.runs.create(created);
        expect(await store.runs.get({ sessionId: 's', runId: 'r2' })).toEqual(created);
      });

      it('persists denials: [] from create, the list written by update (cli/03 F3)', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.denials).toEqual([]);

        const denial = { callId: 'c1', name: 'rm', input: { path: '/' }, reason: 'Denied by policy: rm', by: 'policy' as const };
        await store.runs.update({ sessionId: 's', runId: 'r', status: 'running', denials: [denial] });
        expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.denials).toEqual([denial]);

        // An update without the field leaves the list alone.
        await store.runs.update({ sessionId: 's', runId: 'r', status: 'completed', steps: 2 });
        expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toMatchObject({ status: 'completed', steps: 2, denials: [denial] });
      });

      it('lists runs of a session, newest createdAt first, filtered by status', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.sessions.create({ sessionId: 'other', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r1', { createdAt: '2026-01-01T00:00:01.000Z', status: 'completed' }));
        await store.runs.create(runRecord('s', 'r2', { createdAt: '2026-01-01T00:00:03.000Z', status: 'awaiting' }));
        await store.runs.create(runRecord('s', 'r3', { createdAt: '2026-01-01T00:00:02.000Z', status: 'completed' }));
        await store.runs.create(runRecord('other', 'r4', { createdAt: '2026-01-01T00:00:09.000Z' }));
        expect((await store.runs.list({ sessionId: 's' })).map((r) => r.runId)).toEqual(['r2', 'r3', 'r1']);
        expect((await store.runs.list({ sessionId: 's', status: 'completed' })).map((r) => r.runId)).toEqual(['r3', 'r1']);
        expect((await store.runs.list({ sessionId: 's', status: 'awaiting' })).map((r) => r.runId)).toEqual(['r2']);
        expect(await store.runs.list({ sessionId: 'other', status: 'failed' })).toEqual([]);
        expect(await codeOf(store.runs.list({ sessionId: 'missing' }))).toBe('not_found');
      });

      it('appends steps and updates them by invocationId', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.runs.appendStep({ kind: 'tool', sessionId: 's', runId: 'r', index: 0, invocationId: 'i1', status: 'started', callId: 'c', name: 'echo', input: {}, startedAt: 'now' });
        await store.runs.appendStep({ kind: 'model', sessionId: 's', runId: 'r', index: 1, invocationId: 'i2', status: 'started', startedAt: 'now' });
        await store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'i1', patch: { status: 'completed', original: { content: 'ok', isError: false }, endedAt: 'later' } });
        await store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'i1', patch: { transformed: { content: 'OK', isError: false } } });
        const steps = await store.runs.listSteps({ sessionId: 's', runId: 'r' });
        expect(steps.map((s) => s.invocationId)).toEqual(['i1', 'i2']);
        expect(steps[0]).toMatchObject({ kind: 'tool', status: 'completed', endedAt: 'later', original: { content: 'ok' }, transformed: { content: 'OK' } });
        expect(steps[1]).toMatchObject({ kind: 'model', status: 'started' });
        expect(await codeOf(store.runs.updateStep({ sessionId: 's', runId: 'r', invocationId: 'nope', patch: {} }))).toBe('not_found');
      });

      it('returns clones from get, listEvents and listMessages', async () => {
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

    describe('cut', () => {
      it('truncate keeps the turns through the cut and drops the rest with their logs', async () => {
        await seedCut(store);
        const before = (await store.sessions.get({ sessionId: 's' }))!;
        const result = await store.sessions.truncate({ sessionId: 's', throughMessageId: 'm4' });
        expect(result).toEqual({ remainingMessages: 4, removedMessages: 1, removedRuns: 2 });
        expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
        expect((await store.runs.list({ sessionId: 's' })).map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
        // A kept turn keeps its usage, its steps and its events.
        expect(await store.runs.get({ sessionId: 's', runId: 'r1' })).toMatchObject({ status: 'completed', usage: { inputTokens: 11, outputTokens: 12 }, steps: 2, inputMessageId: 'm1', lastMessageId: 'm2' });
        expect((await store.runs.listSteps({ sessionId: 's', runId: 'r1' })).map((s) => s.invocationId)).toEqual(['i1']);
        expect((await store.runs.listEvents({ sessionId: 's', runId: 'r1' })).map((e) => e.seq)).toEqual([1]);
        expect(await store.requests.get({ sessionId: 's', runId: 'r1', requestId: 'q1' })).toBeDefined();
        // A removed turn answers nothing any more: r3's messages went with it, r4 was never terminal.
        for (const runId of ['r3', 'r4']) {
          expect(await store.runs.get({ sessionId: 's', runId })).toBeUndefined();
          expect(await codeOf(store.runs.listEvents({ sessionId: 's', runId }))).toBe('not_found');
          expect(await codeOf(store.runs.listSteps({ sessionId: 's', runId }))).toBe('not_found');
        }
        expect(await store.requests.get({ sessionId: 's', runId: 'r3', requestId: 'q3' })).toBeUndefined();
        expect((await store.sessions.get({ sessionId: 's' }))!.updatedAt >= before.updatedAt).toBe(true);
      });

      it('truncate refuses not_found and writer_busy, and a paused holder does not block', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        expect(await codeOf(store.sessions.truncate({ sessionId: 'missing', throughMessageId: 'm' }))).toBe('not_found');
        await store.runs.create(runRecord('s', 'r', { status: 'running', inputMessageId: 'm1', lastMessageId: 'm2' }));
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r' });
        await store.sessions.appendMessages({ sessionId: 's', runId: 'r', messages: [msg('m1'), msg('m2')] });
        // A running holder is writing: the cut is refused before the message is even looked up.
        expect(await codeOf(store.sessions.truncate({ sessionId: 's', throughMessageId: 'nope' }))).toBe('writer_busy');
        // Paused: it keeps the claim but writes nothing, so it does not block; the cut then drops it and frees the claim.
        await store.runs.update({ sessionId: 's', runId: 'r', status: 'awaiting' });
        expect(await codeOf(store.sessions.truncate({ sessionId: 's', throughMessageId: 'nope' }))).toBe('not_found');
        expect(await store.sessions.truncate({ sessionId: 's', throughMessageId: 'm2' })).toEqual({ remainingMessages: 2, removedMessages: 0, removedRuns: 1 });
        expect(await store.runs.get({ sessionId: 's', runId: 'r' })).toBeUndefined();
        expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
        expect(await store.sessions.claimWriter({ sessionId: 's', runId: 'next' })).toBe(true);
      });

      it('fork copies the cut into a new session and leaves the source whole', async () => {
        await seedCut(store);
        const sourceMessages = (await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id);
        const sourceRuns = (await store.runs.list({ sessionId: 's' })).map((r) => r.runId).sort();
        const target = await store.sessions.fork({ fromSessionId: 's', throughMessageId: 'm4', sessionId: 'f' });
        expect(target).toMatchObject({ sessionId: 'f', agentId: 'a', workspace: 'w' });
        expect((await store.sessions.listMessages({ sessionId: 'f' })).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
        expect((await store.runs.list({ sessionId: 'f' })).map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
        // Events and steps come with the kept runs, on the target's session id.
        expect(await store.runs.get({ sessionId: 'f', runId: 'r1' })).toMatchObject({ sessionId: 'f', status: 'completed' });
        expect((await store.runs.listEvents({ sessionId: 'f', runId: 'r1' })).map((e) => e.seq)).toEqual([1]);
        expect((await store.runs.listEvents({ sessionId: 'f', runId: 'r1' }))[0]!.sessionId).toBe('f');
        expect((await store.runs.listSteps({ sessionId: 'f', runId: 'r1' }))[0]!.sessionId).toBe('f');
        // A never-terminal run is not a run of the target's, and requests are not copied.
        expect(await store.runs.get({ sessionId: 'f', runId: 'r4' })).toBeUndefined();
        expect(await store.requests.get({ sessionId: 'f', runId: 'r1', requestId: 'q1' })).toBeUndefined();
        // The source is untouched.
        expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.id)).toEqual(sourceMessages);
        expect((await store.runs.list({ sessionId: 's' })).map((r) => r.runId).sort()).toEqual(sourceRuns);
        expect(await store.requests.get({ sessionId: 's', runId: 'r3', requestId: 'q3' })).toBeDefined();
        expect(await store.runs.get({ sessionId: 's', runId: 'r1' })).toMatchObject({ sessionId: 's' });
      });

      it('fork refuses a taken target, an absent source or message, and a running writer', async () => {
        await seedCut(store);
        await store.sessions.create({ sessionId: 'taken', agentId: 'b' });
        expect(await codeOf(store.sessions.fork({ fromSessionId: 's', throughMessageId: 'm2', sessionId: 'taken' }))).toBe('already_exists');
        expect(await codeOf(store.sessions.fork({ fromSessionId: 'missing', throughMessageId: 'm2', sessionId: 'new' }))).toBe('not_found');
        expect(await codeOf(store.sessions.fork({ fromSessionId: 's', throughMessageId: 'nope', sessionId: 'new' }))).toBe('not_found');
        expect(await store.sessions.get({ sessionId: 'new' })).toBeUndefined();
        await store.sessions.claimWriter({ sessionId: 's', runId: 'r1' });
        await store.runs.update({ sessionId: 's', runId: 'r1', status: 'running' });
        expect(await codeOf(store.sessions.fork({ fromSessionId: 's', throughMessageId: 'm2', sessionId: 'new' }))).toBe('writer_busy');
        expect(await store.sessions.get({ sessionId: 'new' })).toBeUndefined();
      });
    });

    describe('requests', () => {
      it('creates, reads and resolves under the owning run', async () => {
        await store.sessions.create({ sessionId: 's', agentId: 'a' });
        await store.runs.create(runRecord('s', 'r'));
        await store.requests.create({ requestId: 'q', sessionId: 's', runId: 'r', kind: 'approval', callId: 'c', payload: { name: 'rm' }, createdAt: 'now' });
        expect(await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'q' })).toMatchObject({ kind: 'approval', callId: 'c', payload: { name: 'rm' } });
        expect(await store.requests.get({ sessionId: 's', runId: 'other', requestId: 'q' })).toBeUndefined();
        expect(await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'missing' })).toBeUndefined();
        expect(await codeOf(store.requests.resolve({ sessionId: 's', runId: 'other', requestId: 'q', resolution: 'approve' }))).toBe('not_found');
        await store.requests.resolve({ sessionId: 's', runId: 'r', requestId: 'q', resolution: { decision: 'approve' } });
        const got = await store.requests.get({ sessionId: 's', runId: 'r', requestId: 'q' });
        expect(got?.resolution).toEqual({ decision: 'approve' });
        expect(typeof got?.resolvedAt).toBe('string');
      });
    });

    describe('kv', () => {
      it('isolates agent, shared and workspace scopes, and shares entries per scope', async () => {
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
        expect(await agent.get('missing')).toBeUndefined();
        await agent.set('k2', 1);
        expect((await agent.list()).sort()).toEqual(['k', 'k2']);
        expect(await agent.list('k2')).toEqual(['k2']);
        await agent.delete('k');
        await agent.delete('never-set');
        expect(await agent.list()).toEqual(['k2']);
      });

      it('accepts keys with slashes and spaces', async () => {
        const kv = store.kv({ kind: 'agent', agentId: 'a' });
        await kv.set('approvals/s 1/rm', true);
        expect(await kv.get('approvals/s 1/rm')).toBe(true);
        expect(await kv.list('approvals/')).toEqual(['approvals/s 1/rm']);
      });

      it('clones values on write and on read', async () => {
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
  });
}
