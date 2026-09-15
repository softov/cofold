import { describe, expect, it } from 'vitest';
import { AgentError } from '@facio/agents';
import { deleteFileTool, testChat } from './testing.js';

const ECHO = [{ text: 'Hello back.' }];

describe('createChat', () => {
  it('starts a session on say, lists it, and reads it back as one complete turn', async () => {
    const { chat } = testChat({ script: ECHO });
    const seen: string[] = [];
    chat.subscribe((id) => seen.push(id));

    const started = await chat.say({ text: 'Hello there' });
    const outcome = await chat.wait(started.sessionId);
    expect(outcome?.status).toBe('completed');

    const rows = await chat.sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: started.sessionId, title: 'Hello there', activity: 'idle', workspace: '/work' });

    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.running).toBe(false);
    expect(snapshot.pending).toBeNull();
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]).toMatchObject({ id: started.runId, input: 'Hello there', state: 'complete' });
    expect(snapshot.turns[0]?.parts).toEqual([{ kind: 'text', id: expect.any(String), text: 'Hello back.' }]);
    expect(seen.filter((id) => id === started.sessionId).length).toBeGreaterThan(1);
    expect(await chat.wait(started.sessionId)).toBeUndefined();
  });

  it('stops at a destructive tool, shows the confirmation, and runs the tool once when approved', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'notes.txt is gone.' }],
      tools: [tool],
    });
    const started = await chat.say({ text: 'Delete notes.txt' });
    expect((await chat.wait(started.sessionId))?.status).toBe('awaiting');

    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.running).toBe(true);
    expect((await chat.sessions())[0]?.activity).toBe('awaiting');
    expect(waiting.pending).toMatchObject({
      kind: 'toolConfirmation',
      call: { name: 'delete_file', status: 'pending-confirmation', input: '{"path":"notes.txt"}', options: [{ id: 'always' }] },
    });
    expect(waiting.turns[0]?.parts.find((part) => part.kind === 'tool')).toMatchObject({ call: { status: 'pending-confirmation' } });
    await expect(chat.say({ sessionId: started.sessionId, text: 'hurry' })).rejects.toMatchObject({ code: 'writer_busy' });

    await chat.approve(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);
    const done = await chat.snapshot(started.sessionId);
    expect(done.pending).toBeNull();
    expect(done.turns[0]?.parts.map((part) => part.kind)).toEqual(['tool', 'text']);
    expect(done.turns[0]?.parts[0]).toMatchObject({ call: { status: 'completed', output: 'deleted notes.txt' } });
  });

  it('denies, and the model hears why', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'Understood, left alone.' }],
      tools: [tool],
    });
    const started = await chat.say({ text: 'Delete notes.txt' });
    await chat.wait(started.sessionId);
    await chat.deny(started.sessionId, { reason: 'keep it' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(0);
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed' } });
  });

  it('projects ask_user as a question block and takes the answers', async () => {
    const { chat } = testChat({
      script: [
        { toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'scope', question: 'Which scope?', options: [{ label: 'tests' }, { label: 'all' }] }, { id: 'name', question: 'Your name?' }] } }] },
        { text: 'Thanks.' },
      ],
    });
    const started = await chat.say({ text: 'Ask me' });
    expect((await chat.wait(started.sessionId))?.status).toBe('awaiting');
    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.pending).toMatchObject({
      kind: 'chatInput',
      message: 'ask_user is asking',
      questions: [
        { id: 'scope', kind: 'single-select', options: [{ id: 'tests', label: 'tests' }, { id: 'all', label: 'all' }], allowFreeformInput: true },
        { id: 'name', kind: 'text' },
      ],
    });
    await chat.answer(started.sessionId, { scope: 'tests', name: 'Ada' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { name: 'ask_user', status: 'completed' } });
    expect((done.turns[0]?.parts[0] as { call: { output: string } }).call.output).toContain('Ada');
  });

  it('lets a second chat on the same store approve what the first left waiting', async () => {
    const { tool, executions } = deleteFileTool();
    const script = [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }];
    const first = testChat({ script, tools: [tool] });
    const started = await first.chat.say({ text: 'Delete a' });
    await first.chat.wait(started.sessionId);

    // The second process's model continues where the conversation is: after the approval, the reply.
    const second = testChat({ script: [{ text: 'Done.' }], tools: [tool], store: first.store });
    const rows = await second.chat.sessions();
    expect(rows[0]?.activity).toBe('awaiting');
    await second.chat.approve(started.sessionId);
    expect((await second.chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);
    expect((await first.chat.snapshot(started.sessionId)).turns[0]?.state).toBe('complete');
  });

  it('cancel denies a waiting approval, refuses to abandon a question, and remove takes the session away', async () => {
    const { executions, tool } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'x' }], tools: [tool] });
    const started = await chat.say({ text: 'Delete a' });
    await chat.wait(started.sessionId);
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(0);
    expect((await chat.snapshot(started.sessionId)).turns[0]?.parts[0]).toMatchObject({ call: { status: 'failed' } });

    const asking = testChat({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'q', question: 'Why?' }] } }] }, { text: 'ok' }] });
    const question = await asking.chat.say({ text: 'Ask' });
    await asking.chat.wait(question.sessionId);
    await expect(asking.chat.cancel(question.sessionId)).rejects.toMatchObject({ code: 'invalid_options' });
    await asking.chat.remove(question.sessionId);
    expect(await asking.chat.sessions()).toEqual([]);

    await chat.remove(started.sessionId);
    expect(await chat.sessions()).toEqual([]);
    await expect(chat.snapshot(started.sessionId)).rejects.toBeInstanceOf(AgentError);
    await expect(chat.approve('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('continues a session with a second turn and keeps both in order', async () => {
    const { chat } = testChat({ script: [{ text: 'First.' }, { text: 'Second.' }] });
    const first = await chat.say({ text: 'One' });
    await chat.wait(first.sessionId);
    const second = await chat.say({ sessionId: first.sessionId, text: 'Two' });
    await chat.wait(second.sessionId);
    const snapshot = await chat.snapshot(first.sessionId);
    expect(snapshot.turns.map((turn) => turn.input)).toEqual(['One', 'Two']);
    expect(snapshot.turns.every((turn) => turn.state === 'complete')).toBe(true);
  });

  it('names a model that is not configured', async () => {
    const { chat } = testChat({ script: ECHO });
    await expect(chat.say({ text: 'x', settings: { model: 'other/m' } })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(chat.say({ text: 'x', settings: { model: 'nomodel' } })).rejects.toMatchObject({ code: 'invalid_options' });
    expect((await chat.models()).map((row) => row.ref)).toEqual(['fake/scripted', 'fake/other']);
  });

  it('starts from the configured defaults and keeps each session own choices', async () => {
    const { chat, provider } = testChat({ script: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], config: { model: undefined } });
    // No model configured: the first the first provider lists.
    expect(await chat.settings()).toEqual({ model: 'fake/scripted', permissions: 'destructive', reasoning: 'off' });

    const started = await chat.say({ text: 'One', settings: { reasoning: 'high', model: 'fake/other' } });
    await chat.wait(started.sessionId);
    expect(provider.asked.at(-1)).toEqual({ id: 'other', params: { reasoning: { effort: 'high' } } });
    expect((await chat.snapshot(started.sessionId)).settings).toEqual({ model: 'fake/other', permissions: 'destructive', reasoning: 'high' });

    await chat.configure(started.sessionId, { reasoning: 'off', permissions: 'ask' });
    expect(await chat.settings(started.sessionId)).toEqual({ model: 'fake/other', permissions: 'ask', reasoning: 'off' });
    await chat.say({ sessionId: started.sessionId, text: 'Two' });
    await chat.wait(started.sessionId);
    expect(provider.asked.at(-1)).toEqual({ id: 'other', params: {} });

    // Another session is untouched by the first one's choices.
    const fresh = await chat.say({ text: 'Three' });
    await chat.wait(fresh.sessionId);
    expect(await chat.settings(fresh.sessionId)).toEqual({ model: 'fake/scripted', permissions: 'destructive', reasoning: 'off' });

    await expect(chat.configure(started.sessionId, { permissions: 'maybe' as never })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(chat.configure('missing', { reasoning: 'low' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('runs a destructive tool without asking on permissions auto, and asks for everything on ask', async () => {
    const { tool, executions } = deleteFileTool();
    const script = [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }];
    const auto = testChat({ script, tools: [tool] });
    const started = await auto.chat.say({ text: 'Delete a', settings: { permissions: 'auto' } });
    expect((await auto.chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);

    const ask = testChat({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'q', question: 'Why?' }] } }] }, { text: 'ok' }] });
    const asking = await ask.chat.say({ text: 'Ask', settings: { permissions: 'ask' } });
    expect((await ask.chat.wait(asking.sessionId))?.status).toBe('awaiting');
    // ask_user itself now waits for approval before it may ask.
    expect((await ask.chat.snapshot(asking.sessionId)).pending?.kind).toBe('toolConfirmation');
  });
});
