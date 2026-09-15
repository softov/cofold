import { describe, expect, it } from 'vitest';
import type { Message, RunRecord } from '@facio/agents';
import { toBlocks } from './blocks.js';
import { parseAnswers, toAskAnswers, toChatQuestion } from './questions.js';
import { inputLine, projectTurns, titleOf } from './turns.js';

const at = '2026-09-16T10:00:00.000Z';
const user = (id: string, text: string): Message => ({ id, role: 'user', source: 'input', parts: [{ type: 'text', text }], createdAt: at });
const assistant = (id: string, parts: Message['parts']): Message => ({ id, role: 'assistant', source: 'model', parts, createdAt: at });
const result = (id: string, callId: string, content: string, isError = false): Message =>
  ({ id, role: 'tool', source: 'tool', parts: [{ type: 'toolResult', callId, name: 'rm', content, isError }], createdAt: at });
const run = (runId: string, status: RunRecord['status'], inputMessageId: string, extra: Partial<RunRecord> = {}): RunRecord =>
  ({ runId, sessionId: 's', agentId: 'papo', status, createdAt: at, updatedAt: '2026-09-16T10:00:02.500Z', usage: { inputTokens: 0, outputTokens: 0 }, steps: 1, inputMessageId, ...extra });

describe('projectTurns', () => {
  it('groups the transcript by run and reads each tool call from its result', () => {
    const messages = [
      user('u1', 'Remove it'),
      assistant('a1', [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'On it.' }, { type: 'toolCall', callId: 'c1', name: 'rm', input: { path: 'x' }, raw: '{"path":"x"}' }]),
      result('t1', 'c1', 'removed x'),
      assistant('a2', [{ type: 'text', text: 'Done.' }]),
      user('u2', 'Thanks'),
      assistant('a3', [{ type: 'toolCall', callId: 'c2', name: 'rm', input: { path: 'y' }, raw: '{}' }]),
      result('t2', 'c2', 'boom', true),
    ];
    const runs = [run('r1', 'completed', 'u1'), run('r2', 'failed', 'u2')];
    const { turns, pending } = projectTurns({ messages, runs, errors: { r2: 'the tool blew up' } });
    expect(pending).toBeNull();
    expect(turns.map((turn) => [turn.id, turn.input, turn.state])).toEqual([['r1', 'Remove it', 'complete'], ['r2', 'Thanks', 'failed']]);
    expect(turns[0]?.parts.map((part) => part.kind)).toEqual(['reasoning', 'text', 'tool', 'text']);
    expect(turns[0]?.parts[2]).toMatchObject({ call: { id: 'c1', name: 'rm', status: 'completed', input: '{"path":"x"}', output: 'removed x' } });
    expect(turns[1]?.parts).toMatchObject([{ kind: 'tool', call: { status: 'failed', output: 'boom' } }, { kind: 'error', message: 'the tool blew up' }]);
    expect(turns[0]?.endedAt).toBe('2026-09-16T10:00:02.500Z');
  });

  it('marks a call without a result by what the run is doing', () => {
    const call = { type: 'toolCall' as const, callId: 'c1', name: 'rm', input: { path: 'x' }, raw: '' };
    const messages = [user('u1', 'go'), assistant('a1', [call])];
    expect(projectTurns({ messages, runs: [run('r1', 'running', 'u1')] }).turns[0]?.parts[0]).toMatchObject({ call: { status: 'running' } });
    expect(projectTurns({ messages, runs: [run('r1', 'cancelled', 'u1')] }).turns[0]).toMatchObject({ state: 'cancelled', parts: [{ call: { status: 'cancelled' } }] });

    const awaiting = projectTurns({
      messages,
      runs: [run('r1', 'awaiting', 'u1', { pendingRequestId: 'q' })],
      pending: { requestId: 'q', sessionId: 's', runId: 'r1', kind: 'approval', callId: 'c1', payload: { name: 'rm', input: { path: 'x' }, prompt: 'Remove x?' }, createdAt: at },
    });
    expect(awaiting.turns[0]?.state).toBe('running');
    expect(awaiting.pending).toEqual({
      kind: 'toolConfirmation',
      id: 'q',
      call: { id: 'c1', name: 'rm', status: 'pending-confirmation', input: '{"path":"x"}', confirmationTitle: 'Remove x?', options: [{ id: 'always', label: 'Always, this session' }] },
    });
    // The same object in the transcript and in the block: what the row shows is what is asked.
    expect((awaiting.turns[0]?.parts[0] as { call: unknown }).call).toBe(awaiting.pending?.kind === 'toolConfirmation' ? awaiting.pending.call : null);
  });

  it('turns an input request into questions', () => {
    const call = { type: 'toolCall' as const, callId: 'c1', name: 'ask_user', input: {}, raw: '{}' };
    const { pending } = projectTurns({
      messages: [user('u1', 'go'), assistant('a1', [call])],
      runs: [run('r1', 'awaiting', 'u1', { pendingRequestId: 'q' })],
      pending: {
        requestId: 'q', sessionId: 's', runId: 'r1', kind: 'input', callId: 'c1', createdAt: at,
        payload: { name: 'ask_user', input: {}, invocationId: 'i', questions: [{ id: 'a', question: 'A?', header: 'Pick', options: [{ label: 'x' }], multiSelect: true, allowOther: false }] },
      },
    });
    expect(pending).toEqual({
      kind: 'chatInput', id: 'q', message: 'ask_user is asking',
      questions: [{ id: 'a', kind: 'multi-select', message: 'Pick: A?', required: true, options: [{ id: 'x', label: 'x' }], allowFreeformInput: false }],
    });
  });

  it('survives a run whose input message never landed', () => {
    const { turns } = projectTurns({ messages: [], runs: [run('r1', 'failed', 'missing')] });
    expect(turns[0]).toMatchObject({ input: '', state: 'failed', parts: [{ kind: 'error' }] });
  });
});

describe('the small helpers', () => {
  it('writes the arguments on one line, falling back to the raw text', () => {
    expect(inputLine({ input: { a: 1 }, raw: '' })).toBe('{"a":1}');
    expect(inputLine({ input: 'ls', raw: '' })).toBe('ls');
    expect(inputLine({ input: undefined, raw: '{not json' })).toBe('{not json');
  });

  it('titles a session by its first message, shortened', () => {
    expect(titleOf([user('u', '  hello\n  world ')], 'id')).toBe('hello world');
    expect(titleOf([user('u', 'x'.repeat(80))], 'id')).toHaveLength(60);
    expect(titleOf([], 'id')).toBe('id');
  });

  it('flattens turns into blocks in transcript order', () => {
    const blocks = toBlocks([{ id: 'r1', input: 'hi', state: 'running', startedAt: at, parts: [{ kind: 'text', id: 'p', text: 'yo' }] }], 'm');
    expect(blocks.map((block) => block.kind)).toEqual(['said', 'header', 'prose']);
    expect(blocks[1]).toMatchObject({ model: 'm', meta: 'running', state: 'running' });
    expect(blocks[2]).toMatchObject({ streaming: true });
  });

  it('maps questions and answers both ways', () => {
    expect(toChatQuestion({ id: 'q', question: 'Why?' })).toEqual({ id: 'q', kind: 'text', message: 'Why?', required: true, allowFreeformInput: true });
    expect(toAskAnswers({ a: { kind: 'selected', value: 'x' }, b: { kind: 'selected-many', value: ['y', 'z'] }, c: { kind: 'text', value: '' }, d: { kind: 'number', value: 3 } }))
      .toEqual({ a: 'x', b: ['y', 'z'], d: '3' });
    expect(parseAnswers(['a=1', 'b=x=y', 'a=2'])).toEqual({ a: ['1', '2'], b: 'x=y' });
    expect(() => parseAnswers(['nope'])).toThrow('id=value');
  });
});
