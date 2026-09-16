import type { ContentPart, Message } from '../types/message.js';
import { describe, expect, it } from 'vitest';
import { assembleRequest, estimateMessageTokens, groupUnits } from './context.js';

const len = (t: string) => t.length;
const signal = new AbortController().signal;

let n = 0;
function msg(role: Message['role'], parts: ContentPart[]): Message {
  n += 1;
  return { id: `m${n}`, role, source: role === 'tool' ? 'tool' : role === 'assistant' ? 'model' : 'input', createdAt: 'now', parts };
}
const user = (text: string) => msg('user', [{ type: 'text', text }]);
const assistantText = (text: string) => msg('assistant', [{ type: 'text', text }]);
const assistantCall = (name: string) => msg('assistant', [{ type: 'toolCall', callId: `c-${name}`, name, input: {}, raw: '{}' }]);
const toolResult = (name: string, content: string) => msg('tool', [{ type: 'toolResult', callId: `c-${name}`, name, content, isError: false }]);

describe('groupUnits', () => {
  it('pairs an assistant tool-call message with the tool messages answering it', () => {
    const history = [user('a'), assistantCall('x'), toolResult('x', '1'), toolResult('x', '2'), assistantText('b'), user('c')];
    const units = groupUnits(history);
    expect(units.map((u) => u.length)).toEqual([1, 3, 1, 1]);
    expect(units[1]!.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool']);
  });

  it('keeps a tool message alone when nothing proposed it', () => {
    expect(groupUnits([toolResult('x', '1')]).map((u) => u.length)).toEqual([1]);
    expect(groupUnits([assistantText('a'), toolResult('x', '1')]).map((u) => u.length)).toEqual([1, 1]);
  });
});

describe('estimateMessageTokens', () => {
  it('counts text, tool calls and results, a flat image cost, and no reasoning', () => {
    expect(estimateMessageTokens(user('abc'), len)).toBe(4 + 3);
    expect(estimateMessageTokens(assistantCall('echo'), len)).toBe(4 + 4 + 2);
    expect(estimateMessageTokens(toolResult('echo', 'hello'), len)).toBe(4 + 5);
    expect(estimateMessageTokens(msg('user', [{ type: 'image', mimeType: 'image/png', data: 'x' }]), len)).toBe(4 + 1000);
    expect(estimateMessageTokens(msg('assistant', [{ type: 'reasoning', text: 'long thought' }, { type: 'text', text: 'ok' }]), len)).toBe(4 + 2);
  });
});

describe('assembleRequest', () => {
  const tools = [{ name: 'echo', description: 'd', input: { type: 'object' as const } }];
  const base = { instructions: 'sys', tools, params: { temperature: 0 }, cacheKey: 's', estimateTokens: len, signal };

  it('keeps only the newest units that fit and never splits a tool-call unit', () => {
    const history = [user('old'), assistantCall('x'), toolResult('x', 'result'), user('new')];
    // costs: old 7, unit(assistantCall x + result) = (4+1+2) + (4+6) = 17, new 7; budget = maxTokens - 3
    const r = assembleRequest({ ...base, history, maxTokens: 3 + 7 + 17 });
    expect(r.messages.map((m) => m.id)).toEqual(history.slice(1).map((m) => m.id));
    const smaller = assembleRequest({ ...base, history, maxTokens: 3 + 7 + 16 });
    expect(smaller.messages.map((m) => m.id)).toEqual([history[3]!.id]);
    expect(r.instructions).toBe('sys');
    expect(r.tools).toBe(tools);
    expect(r.params).toEqual({ temperature: 0 });
    expect(r.signal).toBe(signal);
  });

  it('always includes the newest unit even when it exceeds the budget', () => {
    const history = [user('older'), user('a very long input that does not fit')];
    const r = assembleRequest({ ...base, history, maxTokens: 5 });
    expect(r.messages.map((m) => m.id)).toEqual([history[1]!.id]);
  });

  it('strips reasoning parts from the request but not from the history', () => {
    const withReasoning = msg('assistant', [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'ok' }]);
    const history = [user('q'), withReasoning, user('next')];
    const r = assembleRequest({ ...base, history, maxTokens: 1000 });
    expect(r.messages[1]!.parts).toEqual([{ type: 'text', text: 'ok' }]);
    expect(withReasoning.parts).toHaveLength(2);
    expect(r.messages[0]).toBe(history[0]);
  });
});
