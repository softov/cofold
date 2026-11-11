import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Client, CreateElicitationRequest, CreateElicitationResponse, RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from '@agentclientprotocol/sdk';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { FakeStep } from '@cofold/agents/testing';
import { deleteFileTool, gateTool, testChat } from '../testing.js';
import type { AcpServerOptions } from '../types/acp.js';
import type { Chat } from '../types/chat.js';
import { serveAcp } from './server.js';

/**
 * The protocol's own zod schemas, from the SDK's files: the package exports none, and its client checks
 * only what it is sent, never the answers to what it asked. Every frame `copapo acp` writes is parsed here.
 */
type Parser = { safeParse(value: unknown): { success: boolean; error?: { message: string } } };
const sdkDir = dirname(createRequire(import.meta.url).resolve('@agentclientprotocol/sdk'));
const z = (await import(pathToFileURL(join(sdkDir, 'schema', 'zod.gen.js')).href)) as Record<string, Parser>;

/** What each answer must be, by the method that asked for it. */
const ANSWERS: Record<string, string> = {
  initialize: 'zInitializeResponse', authenticate: 'zAuthenticateResponse',
  'session/new': 'zNewSessionResponse', 'session/load': 'zLoadSessionResponse', 'session/resume': 'zResumeSessionResponse',
  'session/fork': 'zForkSessionResponse', 'session/list': 'zListSessionsResponse', 'session/close': 'zCloseSessionResponse',
  'session/delete': 'zDeleteSessionResponse', 'session/set_mode': 'zSetSessionModeResponse',
  'session/set_config_option': 'zSetSessionConfigOptionResponse', 'session/prompt': 'zPromptResponse',
};
/** What each request or notification copapo sends must be. */
const SENT: Record<string, string> = {
  'session/update': 'zSessionNotification', 'session/request_permission': 'zRequestPermissionRequest', 'elicitation/create': 'zCreateElicitationRequest',
};

/** The official client on one side, `serveAcp` on the other, and every frame between them checked against the schema. */
function connect(chat: Chat, client: Partial<Client>, more: Partial<AcpServerOptions> = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const server = serveAcp({ chatFor: () => chat, workspace: '/work', agentInfo: { name: 'copapo', version: '0.0.1' }, stdin, stdout, warn: () => {}, ...more });
  const asked = new Map<string, string>();
  const invalid: string[] = [];
  const lines = (stream: PassThrough, each: (message: Record<string, unknown>) => void): void => {
    let pending = '';
    stream.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) { each(JSON.parse(pending.slice(0, at)) as Record<string, unknown>); pending = pending.slice(at + 1); }
    });
  };
  lines(stdin, (message) => { if (typeof message['method'] === 'string' && message['id'] !== undefined) asked.set(String(message['id']), message['method']); });
  lines(stdout, (message) => {
    const method = message['method'];
    const name = typeof method === 'string' ? SENT[method] : message['result'] !== undefined ? ANSWERS[asked.get(String(message['id'])) ?? ''] : undefined;
    if (name === undefined) return;
    const parsed = z[name]!.safeParse(typeof method === 'string' ? message['params'] : message['result']);
    if (!parsed.success) invalid.push(`${typeof method === 'string' ? method : asked.get(String(message['id']))}: ${parsed.error?.message}`);
  });
  const updates: SessionNotification[] = [];
  const connection = new ClientSideConnection(() => ({
    sessionUpdate: (notification) => { updates.push(notification); },
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    ...client,
  }) as Client, ndJsonStream(Writable.toWeb(stdin), Readable.toWeb(stdout) as ReadableStream<Uint8Array>));
  const close = async (): Promise<void> => { stdin.end(); await server.closed; };
  return { connection, updates, invalid, close };
}

const text = (updates: SessionNotification[], sessionId: string, kind = 'agent_message_chunk'): string =>
  updates.filter((one) => one.sessionId === sessionId && one.update.sessionUpdate === kind)
    .map((one) => ((one.update as { content: { type: string; text?: string } }).content.text ?? '')).join('');
const ASK: FakeStep = { toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'which', question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }] } }] };

describe('copapo acp under the official ACP client', () => {
  it('serves a session from initialize to delete, every frame as the schema says', async () => {
    const { tool, executions } = deleteFileTool();
    const gate = gateTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Deleted.' }, ASK, { text: 'Chose.' }, { toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Waited.' }, { text: 'In the fork.' }],
      tools: [tool, gate.tool],
      stream: true,
    });
    const permissions: RequestPermissionRequest[] = [];
    const forms: CreateElicitationRequest[] = [];
    const { connection, updates, invalid, close } = connect(chat, {
      requestPermission: async (params): Promise<RequestPermissionResponse> => { permissions.push(params); return { outcome: { outcome: 'selected', optionId: 'allow' } }; },
      createElicitation: async (params): Promise<CreateElicitationResponse> => { forms.push(params); return { action: 'accept', content: { q1: 'B' } }; },
    });

    const init = await connection.initialize({ protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } });
    expect(init.protocolVersion).toBe(1);
    expect(init.agentCapabilities?.sessionCapabilities?.fork).toEqual({});
    const { sessionId, modes, configOptions } = await connection.newSession({ cwd: '/work', mcpServers: [] });
    expect(modes?.currentModeId).toBe('default');
    expect(configOptions?.map((option) => option.category)).toEqual(['model', 'thought_level']);

    // A permission, allowed.
    expect((await connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Delete a' }] })).stopReason).toBe('end_turn');
    expect(executions()).toBe(1);
    expect(permissions).toHaveLength(1);
    expect(text(updates, sessionId)).toBe('Deleted.');

    // A question, answered through the form.
    expect((await connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Choose' }] })).stopReason).toBe('end_turn');
    expect(forms[0]).toMatchObject({ mode: 'form', sessionId });
    expect(text(updates, sessionId)).toBe('Deleted.Chose.');

    // A steer into a running turn; both prompts end with it.
    const first = connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait' }] });
    await gate.entered();
    const second = connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'And this' }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.release();
    expect([(await first).stopReason, (await second).stopReason]).toEqual(['end_turn', 'end_turn']);

    // The mode and an option, from the client.
    await connection.setSessionMode({ sessionId, modeId: 'acceptEdits' });
    const set = await connection.setSessionConfigOption({ sessionId, configId: 'thought_level', value: 'high' });
    expect(set.configOptions.find((option) => option.id === 'thought_level')?.currentValue).toBe('high');

    // A fork, its own turn, and the list.
    const fork = await connection.unstable_forkSession({ sessionId, cwd: '/work' });
    expect((await connection.prompt({ sessionId: fork.sessionId, prompt: [{ type: 'text', text: 'Fork' }] })).stopReason).toBe('end_turn');
    expect(text(updates, fork.sessionId)).toBe('In the fork.');
    const listed = await connection.listSessions({ cwd: '/work' });
    expect(listed.sessions.map((one) => one.sessionId).sort()).toEqual([sessionId, fork.sessionId].sort());

    // A load replays the transcript.
    const before = updates.length;
    await connection.closeSession({ sessionId });
    await connection.loadSession({ sessionId, cwd: '/work', mcpServers: [] });
    const replayed = updates.slice(before).filter((one) => one.sessionId === sessionId);
    expect(text(replayed, sessionId, 'user_message_chunk')).toContain('Delete a');
    expect(text(replayed, sessionId)).toContain('Deleted.');

    await connection.resumeSession({ sessionId: fork.sessionId, cwd: '/work' });
    await connection.deleteSession({ sessionId: fork.sessionId });
    expect((await connection.listSessions({})).sessions.map((one) => one.sessionId)).toEqual([sessionId]);

    expect(invalid).toEqual([]);
    await close();
  });

  it('a cancel during a permission ends the prompt cancelled', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }], tools: [tool] });
    let reached!: () => void;
    const asked = new Promise<void>((resolve) => { reached = resolve; });
    let answer!: (value: RequestPermissionResponse) => void;
    const { connection, invalid, close } = connect(chat, {
      requestPermission: () => { reached(); return new Promise<RequestPermissionResponse>((resolve) => { answer = resolve; }); },
    });
    await connection.initialize({ protocolVersion: 1 });
    const { sessionId } = await connection.newSession({ cwd: '/work', mcpServers: [] });
    const running = connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Delete a' }] });
    await asked;
    await connection.cancel({ sessionId });
    expect((await running).stopReason).toBe('cancelled');
    answer({ outcome: { outcome: 'cancelled' } });
    expect(executions()).toBe(0);
    expect(invalid).toEqual([]);
    await close();
  });

  it('asks to trust a folder with a form tied to session/new, as the schema says', async () => {
    const { chat } = testChat({ script: [] });
    const forms: CreateElicitationRequest[] = [];
    const { connection, invalid, close } = connect(chat, {
      createElicitation: async (params): Promise<CreateElicitationResponse> => { forms.push(params); return { action: 'accept', content: { trust: true } }; },
    }, {
      trustOf: () => ({ state: 'unasked', folder: '/work', gated: ['/work/.copapo.json'], projectTrust: 'ask' }),
      saveTrust: async () => {},
    });
    await connection.initialize({ protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } });
    await connection.newSession({ cwd: '/work', mcpServers: [] });
    expect(forms).toHaveLength(1);
    expect(invalid).toEqual([]);
    await close();
  });
});
