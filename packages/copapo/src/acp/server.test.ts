import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FakeStep } from '@cofold/agents/testing';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeChat } from '../claude/chat.js';
import { fakeClaudeSdk } from '../claude/testing.js';
import { deleteFileTool, gateTool, testChat, testConfig } from '../testing.js';
import type { Chat } from '../types/chat.js';
import { serveAcp } from './server.js';

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } };
type Answerer = (params: Record<string, unknown>) => unknown;

/** A client over two in-memory streams: what it was told, in order, and answers to what it is asked. */
function connect(chat: Chat, answer: Record<string, Answerer> = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const server = serveAcp({ chatFor: () => chat, workspace: '/work', agentInfo: { name: 'copapo', version: '0.0.1' }, stdin, stdout, warn: () => {} });
  const told: Message[] = [];
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  let next = 1;
  let pending = '';
  const write = (message: object): void => { stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`); };
  stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const message = JSON.parse(pending.slice(0, at)) as Message;
      pending = pending.slice(at + 1);
      told.push(message);
      if (message.method !== undefined && message.id !== undefined) {
        const handler = answer[message.method];
        void Promise.resolve(handler?.(message.params ?? {})).then((result) => write({ id: message.id, result: result ?? null }));
      } else if (message.method === undefined && typeof message.id === 'number') {
        const held = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error !== undefined) held?.reject(message.error);
        else held?.resolve(message.result);
      }
    }
  });
  const call = <T = Record<string, unknown>>(method: string, params: object = {}): Promise<T> => {
    const id = next++;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      write({ id, method, params });
    });
  };
  const notify = (method: string, params: object): void => { write({ method, params }); };
  const updates = (sessionId: string): Record<string, unknown>[] =>
    told.filter((message) => message.method === 'session/update' && message.params?.['sessionId'] === sessionId).map((message) => message.params?.['update'] as Record<string, unknown>);
  const text = (sessionId: string, kind = 'agent_message_chunk'): string =>
    updates(sessionId).filter((one) => one['sessionUpdate'] === kind).map((one) => (one['content'] as { text: string }).text).join('');
  const close = async (): Promise<void> => { stdin.end(); await server.closed; };
  return { call, notify, told, updates, text, close };
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Resolves once `check` holds, polling; fails the test after two seconds. */
async function eventually(check: () => boolean): Promise<void> {
  for (let waited = 0; !check(); waited += 10) {
    if (waited > 2000) throw new Error('the condition never held');
    await tick(10);
  }
}
const prompt = (text: string) => [{ type: 'text', text }];
const ASK: FakeStep = { toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'which', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }] } }] };

async function opened(client: ReturnType<typeof connect>, capabilities: object = {}): Promise<string> {
  await client.call('initialize', { protocolVersion: 1, clientCapabilities: capabilities });
  const { sessionId } = await client.call<{ sessionId: string }>('session/new', { cwd: '/work', mcpServers: [] });
  return sessionId;
}

describe('copapo acp', () => {
  it('answers initialize with version 1 and the session capabilities', async () => {
    const { chat } = testChat({ script: [] });
    const client = connect(chat);
    const init = await client.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    expect(init).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: false }, sessionCapabilities: { list: {}, delete: {}, fork: {}, resume: {}, close: {} } },
      authMethods: [],
      agentInfo: { name: 'copapo', version: '0.0.1' },
    });
    expect(await client.call('authenticate', { methodId: 'none' })).toEqual({});
    await client.close();
  });

  it('opens a session with its modes and options, lists it, and deletes it', async () => {
    const { chat } = testChat({ script: [] });
    const client = connect(chat);
    await client.call('initialize', { protocolVersion: 1 });
    const created = await client.call<{ sessionId: string; modes: { currentModeId: string; availableModes: { id: string }[] }; configOptions: { id: string; category: string; currentValue: string; options: { value: string }[] }[] }>('session/new', { cwd: '/work', mcpServers: [] });
    expect(created.modes.currentModeId).toBe('default');
    expect(created.modes.availableModes.map((mode) => mode.id)).toEqual(['default', 'acceptEdits', 'bypassPermissions', 'dontAsk']);
    expect(created.configOptions.map((option) => [option.id, option.category, option.currentValue])).toEqual([['model', 'model', 'fake/scripted'], ['thought_level', 'thought_level', 'off']]);
    expect(created.configOptions[0]!.options.map((option) => option.value)).toEqual(['fake/other', 'fake/scripted']);
    await eventually(() => client.updates(created.sessionId).some((one) => one['sessionUpdate'] === 'available_commands_update'));

    const listed = await client.call<{ sessions: { sessionId: string; cwd: string }[] }>('session/list', {});
    expect(listed.sessions).toEqual([expect.objectContaining({ sessionId: created.sessionId, cwd: '/work' })]);
    expect(await client.call('session/delete', { sessionId: created.sessionId })).toEqual({});
    expect((await client.call<{ sessions: unknown[] }>('session/list', {})).sessions).toEqual([]);
    await expect(client.call('session/prompt', { sessionId: created.sessionId, prompt: prompt('Hi') })).rejects.toMatchObject({ code: -32002 });
    await expect(client.call('session/new', { cwd: 'relative', mcpServers: [] })).rejects.toMatchObject({ code: -32602 });
    await client.close();
  });

  it('runs a turn: the reply as chunks, the title, then end_turn with the usage', async () => {
    const { chat } = testChat({ script: [{ text: 'Hello back.' }], stream: true });
    const client = connect(chat);
    const sessionId = await opened(client);
    const answer = await client.call<{ stopReason: string; usage: { totalTokens: number } }>('session/prompt', { sessionId, prompt: prompt('Hello there') });
    expect(answer.stopReason).toBe('end_turn');
    expect(answer.usage.totalTokens).toBeGreaterThanOrEqual(0);
    expect(client.text(sessionId)).toBe('Hello back.');
    expect(client.text(sessionId, 'user_message_chunk')).toBe('');
    expect(client.updates(sessionId)).toContainEqual(expect.objectContaining({ sessionUpdate: 'session_info_update', title: 'Hello there' }));
    expect(client.updates(sessionId)).toContainEqual(expect.objectContaining({ sessionUpdate: 'usage_update', size: 32_000 }));
    await client.close();
  });

  it('asks before a destructive tool, and runs it once when the client allows it', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }], tools: [tool] });
    const asked: Record<string, unknown>[] = [];
    const client = connect(chat, { 'session/request_permission': (params) => { asked.push(params); return { outcome: { outcome: 'selected', optionId: 'allow' } }; } });
    const sessionId = await opened(client);
    const answer = await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Delete a') });
    expect(answer.stopReason).toBe('end_turn');
    expect(executions()).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ sessionId, toolCall: { title: 'Run delete_file?', status: 'pending' } });
    expect((asked[0]!['options'] as { kind: string }[]).map((option) => option.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    const tools = client.updates(sessionId).filter((one) => one['sessionUpdate'] === 'tool_call' || one['sessionUpdate'] === 'tool_call_update');
    expect(tools[0]).toMatchObject({ sessionUpdate: 'tool_call', title: 'delete_file {"path":"a"}', kind: 'other', rawInput: '{"path":"a"}' });
    expect(tools.at(-1)).toMatchObject({ sessionUpdate: 'tool_call_update', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'deleted a' } }] });
    expect(client.text(sessionId)).toBe('Done.');
    await client.close();
  });

  it('a rejection fails the tool with the reason, and the turn goes on', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Fine.' }], tools: [tool] });
    const client = connect(chat, { 'session/request_permission': () => ({ outcome: { outcome: 'selected', optionId: 'reject' } }) });
    const sessionId = await opened(client);
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Delete a') })).stopReason).toBe('end_turn');
    expect(executions()).toBe(0);
    expect((await chat.snapshot(sessionId)).turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed', output: expect.stringContaining('Rejected in the client') } });
    await client.close();
  });

  it('puts a question to a client that shows forms, and the answer reaches the tool', async () => {
    const { chat } = testChat({ script: [ASK, { text: 'Done.' }] });
    const forms: Record<string, unknown>[] = [];
    const client = connect(chat, { 'elicitation/create': (params) => { forms.push(params); return { action: 'accept', content: { q1: 'B' } }; } });
    const sessionId = await opened(client, { elicitation: { form: {} } });
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Choose') })).stopReason).toBe('end_turn');
    expect(forms[0]).toMatchObject({ mode: 'form', sessionId, requestedSchema: { type: 'object', properties: { q1: { type: 'string', title: 'Which one?', oneOf: [{ const: 'A', title: 'A' }, { const: 'B', title: 'B' }] } }, required: ['q1'] } });
    expect((await chat.snapshot(sessionId)).turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'completed', output: expect.stringContaining('B') } });
    await client.close();
  });

  it('declines a question when the client cannot show a form', async () => {
    const { chat } = testChat({ script: [ASK, { text: 'Done.' }] });
    const client = connect(chat);
    const sessionId = await opened(client);
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Choose') })).stopReason).toBe('end_turn');
    expect(client.told.some((message) => message.method === 'elicitation/create')).toBe(false);
    expect((await chat.snapshot(sessionId)).turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed' } });
    await client.close();
  });

  it('steers a second prompt into the running turn, and answers both when it ends', async () => {
    const gate = gateTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Done.' }], tools: [gate.tool] });
    const client = connect(chat);
    const sessionId = await opened(client);
    const first = client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Wait') });
    await gate.entered();
    const second = client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('And this') });
    await tick();
    gate.release();
    expect((await first).stopReason).toBe('end_turn');
    expect((await second).stopReason).toBe('end_turn');
    const turns = (await chat.snapshot(sessionId)).turns;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.parts).toContainEqual(expect.objectContaining({ kind: 'steer', text: 'And this' }));
    await client.close();
  });

  it('cancels a turn that waits on a permission: the prompt ends cancelled', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }], tools: [tool] });
    let asked!: () => void;
    const reached = new Promise<void>((resolve) => { asked = resolve; });
    let answer!: (value: unknown) => void;
    const client = connect(chat, { 'session/request_permission': () => { asked(); return new Promise((resolve) => { answer = resolve; }); } });
    const sessionId = await opened(client);
    const running = client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Delete a') });
    await reached;
    client.notify('session/cancel', { sessionId });
    expect((await running).stopReason).toBe('cancelled');
    // ACP's client answers what it was asked with `cancelled` after a cancel; nothing is left to decide by then.
    answer({ outcome: { outcome: 'cancelled' } });
    await tick();
    expect(executions()).toBe(0);
    await client.close();
  });

  it('loads a session: the transcript is replayed before the answer', async () => {
    const { chat } = testChat({ script: [{ text: 'One.' }, { text: 'Two.' }] });
    const first = await chat.say({ text: 'First' });
    await chat.wait(first.sessionId);
    await chat.say({ sessionId: first.sessionId, text: 'Second' });
    await chat.wait(first.sessionId);
    const client = connect(chat);
    await client.call('initialize', { protocolVersion: 1 });
    const loaded = await client.call<{ modes: unknown }>('session/load', { sessionId: first.sessionId, cwd: '/work', mcpServers: [] });
    expect(loaded.modes).toBeDefined();
    const before = client.updates(first.sessionId);
    expect(before.map((one) => [one['sessionUpdate'], (one['content'] as { text?: string } | undefined)?.text])).toEqual([
      ['user_message_chunk', 'First'], ['agent_message_chunk', 'One.'], ['user_message_chunk', 'Second'], ['agent_message_chunk', 'Two.'],
    ]);
    await expect(client.call('session/load', { sessionId: 'nope', cwd: '/work', mcpServers: [] })).rejects.toMatchObject({ code: -32002 });
    await client.close();
  });

  it('resumes without a replay, and forks into a new session the list shows', async () => {
    const { chat } = testChat({ script: [{ text: 'One.' }, { text: 'Two.' }] });
    const first = await chat.say({ text: 'First' });
    await chat.wait(first.sessionId);
    const client = connect(chat);
    await client.call('initialize', { protocolVersion: 1 });
    await client.call('session/resume', { sessionId: first.sessionId, cwd: '/work' });
    await tick();
    expect(client.updates(first.sessionId).filter((one) => String(one['sessionUpdate']).endsWith('_chunk'))).toEqual([]);
    const forked = await client.call<{ sessionId: string }>('session/fork', { sessionId: first.sessionId, cwd: '/work' });
    expect(forked.sessionId).not.toBe(first.sessionId);
    const listed = await client.call<{ sessions: { sessionId: string }[] }>('session/list', { cwd: '/work' });
    expect(listed.sessions.map((one) => one.sessionId).sort()).toEqual([first.sessionId, forked.sessionId].sort());
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId: forked.sessionId, prompt: prompt('Again') })).stopReason).toBe('end_turn');
    expect((await chat.snapshot(forked.sessionId)).turns.map((turn) => turn.input)).toEqual(['First', 'Again']);
    expect((await chat.snapshot(first.sessionId)).turns.map((turn) => turn.input)).toEqual(['First']);
    expect(await client.call('session/close', { sessionId: forked.sessionId })).toEqual({});
    await client.close();
  });

  it('takes the mode and the options from the client, and tells it a change made elsewhere', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }], tools: [tool] });
    const client = connect(chat);
    const sessionId = await opened(client);
    expect(await client.call('session/set_mode', { sessionId, modeId: 'bypassPermissions' })).toEqual({});
    const options = await client.call<{ configOptions: { id: string; currentValue: string }[] }>('session/set_config_option', { sessionId, configId: 'model', value: 'fake/other' });
    expect(options.configOptions.find((option) => option.id === 'model')?.currentValue).toBe('fake/other');
    await client.call('session/set_config_option', { sessionId, configId: 'thought_level', value: 'high' });
    expect(await chat.settings(sessionId)).toMatchObject({ permissions: 'bypassPermissions', model: 'fake/other', reasoning: 'high' });
    await expect(client.call('session/set_mode', { sessionId, modeId: 'sometimes' })).rejects.toMatchObject({ code: -32602 });
    await expect(client.call('session/set_config_option', { sessionId, configId: 'colour', value: 'red' })).rejects.toMatchObject({ code: -32602 });

    await client.call('session/set_config_option', { sessionId, configId: 'model', value: 'fake/scripted' });
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Delete a') })).stopReason).toBe('end_turn');
    expect(executions()).toBe(1);
    expect(client.told.some((message) => message.method === 'session/request_permission')).toBe(false);

    await chat.configure(sessionId, { permissions: 'dontAsk' });
    await eventually(() => client.updates(sessionId).some((one) => one['sessionUpdate'] === 'current_mode_update' && one['currentModeId'] === 'dontAsk'));
    await client.close();
  });

  it('runs the claude backend behind the same protocol: a turn with a permission', async () => {
    const sdk = fakeClaudeSdk();
    sdk.replies = [{ tool: 'Bash', input: { command: 'rm a' }, output: 'deleted a', then: 'Done.' }];
    const chat = createClaudeChat({ config: testConfig({ model: undefined }), workspace: '/work', home: join(tmpdir(), `copapo-acp-${randomUUID()}`), sdk, warn: () => {} });
    const asked: Record<string, unknown>[] = [];
    const client = connect(chat, { 'session/request_permission': (params) => { asked.push(params); return { outcome: { outcome: 'selected', optionId: 'allow' } }; } });
    const sessionId = await opened(client);
    expect((await client.call<{ stopReason: string }>('session/prompt', { sessionId, prompt: prompt('Delete a') })).stopReason).toBe('end_turn');
    expect(asked[0]).toMatchObject({ sessionId, toolCall: { kind: 'execute' } });
    expect(client.updates(sessionId)).toContainEqual(expect.objectContaining({ sessionUpdate: 'tool_call', kind: 'execute' }));
    expect(client.text(sessionId)).toContain('Done.');
    await client.close();
  });
});
