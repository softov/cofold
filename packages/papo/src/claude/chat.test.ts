import { describe, expect, it } from 'vitest';
import { testConfig } from '../testing.js';
import type { Chat } from '../types/chat.js';
import { CLAUDE_PROVIDER, createClaudeChat } from './chat.js';
import { COMPACTED_INPUT } from './project.js';
import type { FakeClaudeSdk, FakeReply } from './testing.js';
import { fakeClaudeSdk } from './testing.js';

function claudeChat(replies: FakeReply[] = [], config: Parameters<typeof testConfig>[0] = { model: undefined }): { chat: Chat; sdk: FakeClaudeSdk } {
  const sdk = fakeClaudeSdk();
  sdk.replies.push(...replies);
  const chat = createClaudeChat({ config: testConfig(config), workspace: 'C:\\work', sdk, warn: () => {} });
  return { chat, sdk };
}

const ASK = {
  tool: 'AskUserQuestion',
  input: { questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A', description: 'the first' }, { label: 'B' }], multiSelect: false }] },
  then: 'A it is.',
};

describe('createClaudeChat', () => {
  it('starts a session on say, lists it, and reads the CLI store back as one complete turn', async () => {
    const { chat, sdk } = claudeChat([{ text: 'Hello back.' }]);
    const seen: string[] = [];
    chat.subscribe((id) => seen.push(id));

    const started = await chat.say({ text: 'Hello there' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(sdk.queries).toHaveLength(1);
    expect(sdk.queries[0]?.options).toMatchObject({ cwd: 'C:\\work', sessionId: started.sessionId, permissionMode: 'default', settingSources: ['user', 'project'] });
    expect(sdk.queries[0]?.options?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });

    const rows = await chat.sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: started.sessionId, title: 'Hello there', activity: 'idle', workspace: 'C:\\work' });

    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.running).toBe(false);
    expect(snapshot.pending).toBeNull();
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]).toMatchObject({ input: 'Hello there', state: 'complete', usage: { inputTokens: 10, outputTokens: 5 }, steps: 1 });
    expect(snapshot.turns[0]?.parts).toEqual([{ kind: 'text', id: expect.any(String), text: 'Hello back.' }]);
    expect(seen.filter((id) => id === started.sessionId).length).toBeGreaterThan(1);
    expect(await chat.wait(started.sessionId)).toBeUndefined();

    // The second turn rides the same process.
    await chat.say({ sessionId: started.sessionId, text: 'Again' });
    await chat.wait(started.sessionId);
    expect(sdk.queries).toHaveLength(1);
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['Hello there', 'Again']);
  });

  it('stops at canUseTool, shows the confirmation, and lets the tool run when approved', async () => {
    const { chat, sdk } = claudeChat([{ tool: 'Write', input: { file_path: 'notes.txt', content: 'x' }, suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], output: 'File written', then: 'Written.' }]);
    const started = await chat.say({ text: 'Write notes.txt' });
    expect((await chat.wait(started.sessionId))).toMatchObject({ status: 'awaiting', kind: 'approval' });

    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.running).toBe(true);
    expect((await chat.sessions())[0]?.activity).toBe('awaiting');
    expect(waiting.pending).toMatchObject({
      kind: 'toolConfirmation',
      call: { name: 'Write', status: 'pending-confirmation', input: '{"file_path":"notes.txt","content":"x"}', confirmationTitle: 'Run Write?', options: [{ id: 'always' }] },
    });
    expect(waiting.turns[0]?.parts.find((part) => part.kind === 'tool')).toMatchObject({ call: { status: 'pending-confirmation' } });
    await expect(chat.say({ sessionId: started.sessionId, text: 'hurry' })).rejects.toMatchObject({ code: 'writer_busy' });
    await expect(chat.answer(started.sessionId, {})).rejects.toMatchObject({ code: 'invalid_options' });

    await chat.approve(started.sessionId, { always: true });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.pending).toBeNull();
    expect(done.turns[0]?.parts.map((part) => part.kind)).toEqual(['tool', 'text']);
    expect(done.turns[0]?.parts[0]).toMatchObject({ call: { status: 'completed', output: 'File written' } });
    expect(sdk.store.get(started.sessionId)?.filter((message) => message.type === 'user')).toHaveLength(2);
  });

  it('denies with the reason, which the CLI hands the model as the tool result', async () => {
    const { chat } = claudeChat([{ tool: 'Bash', input: { command: 'rm -rf /' }, then: 'never said' }]);
    const started = await chat.say({ text: 'Clean up' });
    await chat.wait(started.sessionId);
    await chat.deny(started.sessionId, { reason: 'Not that.' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed', output: 'Not that.' } });
    expect(done.turns[0]?.parts[1]).toMatchObject({ kind: 'text', text: 'Understood: Not that.' });
    await expect(chat.deny(started.sessionId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('shows AskUserQuestion as the question form and answers it through updatedInput', async () => {
    const { chat, sdk } = claudeChat([ASK]);
    const started = await chat.say({ text: 'Choose' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'input' });
    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.pending).toMatchObject({
      kind: 'chatInput',
      questions: [{ id: 'Which one?', kind: 'single-select', message: 'Pick: Which one?', options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], allowFreeformInput: true }],
    });
    await chat.answer(started.sessionId, { 'Which one?': 'A' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { name: 'AskUserQuestion', status: 'completed', output: '{"Which one?":"A"}' } });
    expect(done.turns[0]?.parts[1]).toMatchObject({ kind: 'text', text: 'A it is.' });
    expect(sdk.queries).toHaveLength(1);
  });

  it('cancels a running turn through interrupt and a waiting one by denying it', async () => {
    const { chat } = claudeChat([{ hang: true }, { tool: 'Bash', input: { command: 'ls' } }]);
    const started = await chat.say({ text: 'Think forever' });
    expect((await chat.snapshot(started.sessionId)).running).toBe(true);
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    const after = await chat.snapshot(started.sessionId);
    expect(after.running).toBe(false);
    expect(after.turns[0]).toMatchObject({ state: 'complete' });
    expect(after.turns[0]?.parts).toEqual([{ kind: 'notice', id: expect.any(String), text: 'Request interrupted by user' }]);

    await chat.say({ sessionId: started.sessionId, text: 'List' });
    await chat.wait(started.sessionId);
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect((await chat.snapshot(started.sessionId)).turns[1]?.parts[0]).toMatchObject({ call: { status: 'failed', output: 'cancelled by the user' } });
  });

  it('records a failed turn against its input, which the store keeps no trace of', async () => {
    const { chat } = claudeChat([{ fail: 'Rate limited' }, { text: 'Fine now.' }]);
    const started = await chat.say({ text: 'Go' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'failed', error: { message: 'Rate limited' } });
    const failed = await chat.snapshot(started.sessionId);
    expect(failed.turns[0]).toMatchObject({ state: 'failed' });
    expect(failed.turns[0]?.parts.at(-1)).toMatchObject({ kind: 'error', message: 'Rate limited' });

    await chat.say({ sessionId: started.sessionId, text: 'Retry' });
    await chat.wait(started.sessionId);
    const turns = (await chat.snapshot(started.sessionId)).turns;
    expect(turns.map((turn) => turn.state)).toEqual(['complete', 'complete']);
  });

  it('compacts by sending the CLI its own command and projects the summary the store keeps', async () => {
    const { chat } = claudeChat([{ text: 'One.' }, { text: 'Two.' }]);
    const started = await chat.say({ text: 'First' });
    await chat.wait(started.sessionId);
    await chat.say({ sessionId: started.sessionId, text: 'Second' });
    await chat.wait(started.sessionId);

    const compacting = await chat.compact(started.sessionId);
    expect(compacting.sessionId).toBe(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual([COMPACTED_INPUT, 'Second', '/compact']);
    expect(after.turns[0]?.parts[0]).toMatchObject({ kind: 'summary', text: 'Summary of 4 messages' });
    expect(after.turns[2]?.parts[0]).toMatchObject({ kind: 'notice', text: 'Compacted' });
    expect(after.settings.autoCompact).toBe(true);
  });

  it('removes a session from the CLI store and ends its process', async () => {
    const { chat, sdk } = claudeChat([{ text: 'Hi.' }]);
    const started = await chat.say({ text: 'Hello' });
    await chat.wait(started.sessionId);
    await chat.remove(started.sessionId);
    expect(sdk.queries[0]?.closed).toBe(true);
    expect(await chat.sessions()).toEqual([]);
    await expect(chat.snapshot(started.sessionId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('resumes a session the store has with a fresh process', async () => {
    const { chat, sdk } = claudeChat([{ text: 'Hi.' }, { text: 'Still here.' }]);
    const started = await chat.say({ text: 'Hello' });
    await chat.wait(started.sessionId);
    await chat.close();
    expect(sdk.queries[0]?.closed).toBe(true);

    await chat.say({ sessionId: started.sessionId, text: 'Back' });
    await chat.wait(started.sessionId);
    expect(sdk.queries).toHaveLength(2);
    expect(sdk.queries[1]?.options).toMatchObject({ resume: started.sessionId });
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['Hello', 'Back']);
  });

  it('lists the CLI models and commands as papo rows', async () => {
    const { chat, sdk } = claudeChat();
    const models = await chat.models();
    expect(models.map((model) => model.ref)).toEqual(['claude/sonnet', 'claude/opus']);
    expect(models[0]).toMatchObject({ id: 'sonnet', name: 'Sonnet', provider: CLAUDE_PROVIDER, features: { tools: true } });
    const skills = await chat.skills();
    expect(skills.map((skill) => skill.name)).toEqual(['compact', 'review']);
    // Each listing is a throwaway process, closed after.
    expect(sdk.queries.map((query) => query.closed)).toEqual([true, true]);
  });

  it('applies settings live where the process takes them and restarts it where it does not', async () => {
    const { chat, sdk } = claudeChat([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    expect(await chat.settings()).toMatchObject({ model: '', permissions: 'destructive', reasoning: 'off' });
    await expect(chat.configure('s', { model: 'fake/x' })).rejects.toMatchObject({ code: 'invalid_options' });

    const started = await chat.say({ text: 'One', settings: { model: 'claude/opus' } });
    await chat.wait(started.sessionId);
    expect(sdk.queries[0]?.options).toMatchObject({ model: 'opus' });
    expect(sdk.queries[0]?.options?.effort).toBeUndefined();

    await chat.configure(started.sessionId, { permissions: 'auto' });
    expect(sdk.queries[0]?.mode).toBe('bypassPermissions');
    await chat.say({ sessionId: started.sessionId, text: 'Two' });
    await chat.wait(started.sessionId);
    expect(sdk.queries).toHaveLength(1);

    await chat.configure(started.sessionId, { reasoning: 'high' });
    await chat.say({ sessionId: started.sessionId, text: 'Three' });
    await chat.wait(started.sessionId);
    expect(sdk.queries).toHaveLength(2);
    expect(sdk.queries[0]?.closed).toBe(true);
    expect(sdk.queries[1]?.options).toMatchObject({ resume: started.sessionId, model: 'opus', effort: 'high', permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true });
    expect(await chat.settings(started.sessionId)).toMatchObject({ model: 'claude/opus', permissions: 'auto', reasoning: 'high' });
  });
});
