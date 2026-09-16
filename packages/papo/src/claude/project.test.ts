import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ChatToolCall } from '@textui/chat';
import type { ClaudeSessionMessage } from '../types/claude.js';
import { COMPACTED_INPUT, isCommandEcho, projectSession } from './project.js';
import { loadClaudeSdk } from './sdk.js';

const fixture = async (name: string): Promise<ClaudeSessionMessage[]> =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as ClaudeSessionMessage[];
const idle = { running: false, pending: null };

describe('projectSession', () => {
  it('reads a turn with a question, a write and a reply from a real session', async () => {
    const { turns, pending } = projectSession(await fixture('tool-session'), idle);
    expect(pending).toBeNull();
    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn).toMatchObject({
      id: '1a8ddfe0-6727-485d-940b-b36350ccb0f4',
      input: expect.stringContaining('First call the AskUserQuestion tool'),
      state: 'complete',
      steps: 3,
      startedAt: '2026-09-16T02:55:45.774Z',
      endedAt: '2026-09-16T02:55:52.849Z',
    });
    expect(turn!.parts.map((part) => part.kind)).toEqual(['tool', 'tool', 'text']);
    expect(turn!.parts[0]).toMatchObject({ kind: 'tool', call: { id: 'toolu_01CaenP8ymKh1acF5C7PUV6k', name: 'AskUserQuestion', status: 'completed', output: expect.stringContaining('"Red"') } });
    expect(turn!.parts[1]).toMatchObject({ kind: 'tool', call: { name: 'Write', status: 'completed', input: '{"file_path":"C:\\\\work\\\\color.txt","content":"Red\\n"}' } });
    expect(turn!.parts[2]).toMatchObject({ kind: 'text', text: 'Your answer "Red" has been saved to color.txt in the current folder.' });
    // Cached input counts as input read: 2 + 28920 + 2 + 28920 + 211 + 2 + 29131 + 269.
    expect(turn!.usage).toEqual({ inputTokens: 87457, outputTokens: 311 });
  });

  it('reads the view after a compaction: the summary, the tail, then the /compact echo with what it printed', async () => {
    const { turns } = projectSession(await fixture('compacted-session'), idle);
    expect(turns.map((turn) => [turn.input, turn.parts.map((part) => part.kind)])).toEqual([
      [COMPACTED_INPUT, ['summary', 'text']],
      ['/compact', ['notice']],
    ]);
    expect(turns[0]!.parts[0]).toMatchObject({ kind: 'summary', text: expect.stringContaining('This session is being continued') });
    expect(turns[1]!.parts[0]).toMatchObject({ kind: 'notice', text: 'Compacted' });
    expect(isCommandEcho('<command-name>/compact</command-name>')).toBe(true);
    expect(isCommandEcho('hello')).toBe(false);
  });

  it('marks the open call by what this process knows: waiting on the person, running, or cancelled', async () => {
    const messages = (await fixture('tool-session')).slice(0, 2);
    const waiting: ChatToolCall = { id: 'toolu_01CaenP8ymKh1acF5C7PUV6k', name: 'AskUserQuestion', status: 'pending-confirmation', input: '' };
    const asked = projectSession(messages, { running: true, pending: { kind: 'toolConfirmation', id: 'q', call: waiting } });
    expect(asked.turns[0]).toMatchObject({ state: 'running', parts: [{ call: { status: 'pending-confirmation' } }] });
    expect(asked.pending?.kind).toBe('toolConfirmation');
    expect(projectSession(messages, { running: true, pending: null }).turns[0]!.parts[0]).toMatchObject({ call: { status: 'running' } });
    const dead = projectSession(messages, { running: false, pending: null, errors: { '1a8ddfe0-6727-485d-940b-b36350ccb0f4': 'the CLI stopped' } });
    expect(dead.turns[0]).toMatchObject({ state: 'failed', parts: [{ call: { status: 'cancelled' } }, { kind: 'error', message: 'the CLI stopped' }] });
    expect(dead.pending).toBeNull();
  });

  it('leaves subagent traffic out and a turn without a prompt gets an empty input', () => {
    const messages: ClaudeSessionMessage[] = [
      { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'Hi.' }] } },
      { type: 'assistant', uuid: 'b', session_id: 's', parent_tool_use_id: 'toolu_parent', message: { role: 'assistant', content: [{ type: 'text', text: 'subagent says' }] } },
    ];
    const { turns } = projectSession(messages, idle);
    expect(turns).toEqual([expect.objectContaining({ id: 'a', input: '', parts: [{ kind: 'reasoning', id: 'a:0', text: 'hm' }, { kind: 'text', id: 'a:1', text: 'Hi.' }] })]);
  });
});

describe('loadClaudeSdk', () => {
  it('loads the peer when it is installed', async () => {
    const sdk = await loadClaudeSdk();
    expect(typeof sdk.query).toBe('function');
    expect(typeof sdk.listSessions).toBe('function');
  });

  it('names the install when the peer is missing', async () => {
    const missing = () => Promise.reject(Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' }));
    await expect(loadClaudeSdk(missing)).rejects.toMatchObject({ code: 'invalid_options', message: 'install @anthropic-ai/claude-agent-sdk to use the claude backend' });
  });
});
