import { describe, expect, it } from 'vitest';
import type { Message, RunRecord } from '@doopx/agents';
import { toBlocks } from './blocks.js';
import { parseAnswers, toAskAnswers, toChatQuestion } from './questions.js';
import { toMarkdown } from './export.js';
import { inputLine, projectTurns, titleOf } from './turns.js';
import type { Turn } from './types/turn.js';

const at = '2026-09-16T10:00:00.000Z';
const user = (id: string, text: string): Message => ({ id, role: 'user', source: 'input', parts: [{ type: 'text', text }], createdAt: at });
const assistant = (id: string, parts: Message['parts']): Message => ({ id, role: 'assistant', source: 'model', parts, createdAt: at });
const result = (id: string, callId: string, content: string, isError = false): Message =>
  ({ id, role: 'tool', source: 'tool', parts: [{ type: 'toolResult', callId, name: 'rm', content, isError }], createdAt: at });
const run = (runId: string, status: RunRecord['status'], inputMessageId: string, extra: Partial<RunRecord> = {}): RunRecord =>
  ({ runId, sessionId: 's', agentId: 'papo', status, createdAt: at, updatedAt: '2026-09-16T10:00:02.500Z', usage: { inputTokens: 0, outputTokens: 0 }, steps: 1, denials: [], inputMessageId, ...extra });

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

  it('reads a stopped run by its reason: a hook stop is complete, a limit stop is failed and named', () => {
    const messages = [user('u1', 'go'), assistant('a1', [{ type: 'text', text: 'Done.' }]), user('u2', 'more'), assistant('a2', [{ type: 'text', text: 'Some.' }]), user('u3', 'again')];
    const runs = [run('r1', 'stopped', 'u1'), run('r2', 'stopped', 'u2'), run('r3', 'stopped', 'u3')];
    const { turns } = projectTurns({ messages, runs, stopped: { r1: 'hook', r2: 'max_cost' } });
    expect(turns[0]).toMatchObject({ state: 'complete', parts: [{ kind: 'text', text: 'Done.' }] });
    expect(turns[1]).toMatchObject({ state: 'failed', parts: [{ kind: 'text' }, { kind: 'error', message: 'stopped: max_cost' }] });
    // A stopped run whose last event is missing is still not complete.
    expect(turns[2]).toMatchObject({ state: 'failed', parts: [{ kind: 'error', message: 'stopped' }] });
  });

  it('shows the model\'s view after a compaction: the summary turn first, the tail after it, the covered runs gone', () => {
    const summary: Message = { id: 's1', role: 'user', source: 'summary', parts: [{ type: 'text', text: 'Summary.' }], createdAt: at, summarizes: ['u1', 'a1', 'ask'] };
    const ask: Message = { id: 'ask', role: 'user', source: 'system', parts: [{ type: 'text', text: 'Summarize the conversation so far.' }], createdAt: at };
    const disk = [user('u1', 'First'), assistant('a1', [{ type: 'text', text: 'One.' }]), user('u2', 'Second'), assistant('a2', [{ type: 'text', text: 'Two.' }]), ask, summary, user('u3', 'Third'), assistant('a3', [{ type: 'text', text: 'Three.' }])];
    const runs = [run('r1', 'completed', 'u1'), run('r2', 'completed', 'u2'), run('rc', 'completed', 'ask', { steps: 1 }), run('r3', 'completed', 'u3')];
    const compactions = { s1: { runId: 'rc', before: 900, after: 300 } };
    // The view: the summary moved to the front, the covered messages and the ask gone (contextOf).
    const view = [summary, disk[2]!, disk[3]!, disk[6]!, disk[7]!];
    const { turns } = projectTurns({ messages: view, runs, compactions });
    expect(turns.map((turn) => [turn.id, turn.input, turn.state])).toEqual([['rc', '(context compacted)', 'complete'], ['r2', 'Second', 'complete'], ['r3', 'Third', 'complete']]);
    expect(turns[0]?.parts).toEqual([{ kind: 'summary', id: 's1', text: 'Summary.', before: 900, after: 300 }]);
    expect(turns[0]?.steps).toBe(1);
    expect(turns[1]?.parts).toEqual([{ kind: 'text', id: 'a2:0', text: 'Two.' }]);
    expect(toBlocks(turns)[2]).toMatchObject({ kind: 'notice', content: 'Context compacted: 900 tokens to 300.' });
    // Without the event, the turn stands on the message: its own id, no numbers, the plain notice.
    const bare = projectTurns({ messages: view, runs }).turns[0];
    expect(bare).toMatchObject({ id: 's1', input: '(context compacted)', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0, parts: [{ kind: 'summary', id: 's1' }] });
    expect(toBlocks([bare!])[2]).toMatchObject({ kind: 'notice', content: expect.stringContaining('folded into this summary') });
    // The whole transcript (`--all`): every run where it happened, the summary inside the compaction run's turn.
    const all = projectTurns({ messages: disk, runs, compactions });
    expect(all.turns.map((turn) => turn.input)).toEqual(['First', 'Second', 'Summarize the conversation so far.', 'Third']);
    expect(all.turns[2]?.parts).toEqual([{ kind: 'summary', id: 's1', text: 'Summary.', before: 900, after: 300 }]);
    // An auto-compaction: the run keeps its place and the summary turn stands alone before the tail.
    const auto = projectTurns({ messages: [summary, disk[2]!, disk[3]!, disk[6]!, disk[7]!], runs: [runs[0]!, runs[1]!, runs[3]!], compactions: { s1: { runId: 'r3', before: 900, after: 300 } } });
    expect(auto.turns.map((turn) => turn.id)).toEqual(['s1', 'r2', 'r3']);
  });

  it('shows the interrupt marker as a notice, in Claude\'s words', () => {
    const marker: Message = { id: 'm', role: 'user', source: 'system', parts: [{ type: 'text', text: '[Request interrupted by user]' }], createdAt: at };
    const call = { type: 'toolCall' as const, callId: 'c1', name: 'rm', input: {}, raw: '' };
    const { turns } = projectTurns({ messages: [user('u1', 'go'), assistant('a1', [call]), result('t1', 'c1', 'The turn was stopped', true), marker], runs: [run('r1', 'cancelled', 'u1')] });
    expect(turns[0]).toMatchObject({ state: 'cancelled', parts: [{ kind: 'tool', call: { status: 'failed' } }, { kind: 'notice', id: 'm', text: 'Request interrupted by user' }] });
  });

  it('appends the draft to the running turn as streaming parts, after what the store holds', () => {
    const call = { type: 'toolCall' as const, callId: 'c1', name: 'rm', input: { path: 'x' }, raw: '' };
    const messages = [user('u1', 'go'), assistant('a1', [call]), result('t1', 'c1', 'removed x'), user('u2', 'later')];
    const runs = [run('r1', 'completed', 'u1'), run('r2', 'running', 'u2')];
    const draft = { runId: 'r2', step: 1, text: 'On i', reasoning: 'hmm' };
    const { turns } = projectTurns({ messages, runs, draft });
    expect(turns[0]?.parts.map((part) => part.kind)).toEqual(['tool']);
    expect(turns[1]?.parts).toEqual([
      { kind: 'reasoning', id: 'r2:draft:reasoning', text: 'hmm', streaming: true },
      { kind: 'text', id: 'r2:draft:text', text: 'On i', streaming: true },
    ]);
    // No reasoning yet: only the text part; an empty text still shows, as the place the answer is being written.
    expect(projectTurns({ messages, runs, draft: { ...draft, reasoning: '', text: '' } }).turns[1]?.parts).toEqual([{ kind: 'text', id: 'r2:draft:text', text: '', streaming: true }]);
    // A draft of a run that is not there is nobody's.
    expect(projectTurns({ messages, runs, draft: { ...draft, runId: 'r9' } }).turns[1]?.parts).toEqual([]);
    const blocks = toBlocks(turns);
    expect(blocks.filter((block) => block.kind === 'reasoning' || block.kind === 'prose')).toMatchObject([{ kind: 'reasoning', streaming: true }, { kind: 'prose', streaming: true }]);
  });
});

describe('toMarkdown', () => {
  it('writes the turns with tool calls as lines and a failure as a quote', () => {
    const usage = { inputTokens: 3, outputTokens: 4 };
    const turns: Turn[] = [
      { id: 'r1', input: 'Read it', state: 'complete', startedAt: at, endedAt: at, usage, steps: 2, parts: [
        { kind: 'tool', id: 'c1', call: { id: 'c1', name: 'read_file', input: '{"path":"a"}', status: 'completed', output: '1|x' } },
        { kind: 'text', id: 't', text: 'It says x.' },
      ] },
      { id: 'r2', input: 'Again', state: 'failed', startedAt: at, endedAt: at, usage, steps: 1, parts: [{ kind: 'error', id: 'e', message: 'boom' }] },
    ];
    const snapshot = {
      session: { id: 's1', title: 'Read it', activity: 'idle' as const, workspace: '/w', updatedAt: at, createdAt: at },
      settings: { model: 'p/m', permissions: 'default' as const, reasoning: 'off' as const, autoCompact: false },
      turns, pending: null, running: false, queued: [],
    };
    expect(toMarkdown(snapshot)).toBe([
      '# Read it', '', 'Session `s1` · model `p/m` · permissions default · thinking off', '',
      '## You', '', 'Read it', '', '## papo', '', '- `read_file({"path":"a"})` → completed', '', 'It says x.', '', '',
      '## You', '', 'Again', '', '## papo', '', '> Failed: boom', '',
    ].join('\n'));
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
    const blocks = toBlocks([{ id: 'r1', input: 'hi', state: 'running', startedAt: at, usage: { inputTokens: 0, outputTokens: 0 }, steps: 1, parts: [{ kind: 'text', id: 'p', text: 'yo' }] }], 'm');
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
