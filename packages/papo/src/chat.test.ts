import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentError } from '@facio/agents';
import type { ModelProvider } from '@facio/agents';
import type { FakeModel } from '@facio/agents/testing';
import { deleteFileTool, gateTool, testChat } from './testing.js';

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

  it('cancel on a waiting approval: the harness denies it and the turn ends cancelled with its marker; deny declines a question; remove takes the session away', async () => {
    const { executions, tool } = deleteFileTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'x' }], tools: [tool] });
    const started = await chat.say({ text: 'Delete a' });
    await chat.wait(started.sessionId);
    await chat.cancel(started.sessionId);
    // Decision 120: papo no longer denies on its own; the harness answers the request and ends the turn.
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    expect(executions()).toBe(0);
    const cancelled = await chat.snapshot(started.sessionId);
    expect(cancelled.pending).toBeNull();
    expect(cancelled.turns[0]?.state).toBe('cancelled');
    expect(cancelled.turns[0]?.parts).toMatchObject([
      { kind: 'tool', call: { status: 'failed', output: 'The turn was stopped' } },
      { kind: 'notice', text: 'Request interrupted by user' },
    ]);
    // The same on a session this process did not run: the handle is resumed for the cancel.
    const second = deleteFileTool();
    const first = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'b' } }] }], tools: [second.tool] });
    const left = await first.chat.say({ text: 'Delete b' });
    await first.chat.wait(left.sessionId);
    const other = testChat({ script: [], tools: [second.tool], store: first.store });
    await other.chat.cancel(left.sessionId);
    expect((await other.chat.wait(left.sessionId))?.status).toBe('cancelled');
    expect(second.executions()).toBe(0);
    expect((await other.chat.snapshot(left.sessionId)).turns[0]).toMatchObject({ state: 'cancelled', parts: [{ kind: 'tool', call: { status: 'failed' } }, { kind: 'notice' }] });

    const asking = testChat({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'q', question: 'Why?' }] } }] }, { text: 'ok' }] });
    const question = await asking.chat.say({ text: 'Ask' });
    await asking.chat.wait(question.sessionId);
    await asking.chat.deny(question.sessionId);
    expect((await asking.chat.wait(question.sessionId))?.status).toBe('completed');
    const declined = await asking.chat.snapshot(question.sessionId);
    expect(declined.pending).toBeNull();
    expect(declined.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { name: 'ask_user', status: 'failed', output: 'The user declined to answer' } });
    await asking.chat.remove(question.sessionId);
    expect(await asking.chat.sessions()).toEqual([]);

    await chat.remove(started.sessionId);
    expect(await chat.sessions()).toEqual([]);
    await expect(chat.snapshot(started.sessionId)).rejects.toBeInstanceOf(AgentError);
    await expect(chat.approve('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('steers a running turn: the message lands after the tool result, before the next model step', async () => {
    const gate = gateTool();
    const { chat, provider } = testChat({ script: [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Heard you.' }], tools: [gate.tool] });
    const started = await chat.say({ text: 'Wait for me' });
    await gate.entered();
    expect((await chat.snapshot(started.sessionId)).running).toBe(true);

    // Resolves once the steer is in the transcript, which is at the top of the next model step.
    const steering = chat.say({ sessionId: started.sessionId, text: 'Also, be brief' });
    gate.release();
    expect(await steering).toEqual({ sessionId: started.sessionId, runId: started.runId, steered: true });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');

    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.input).toBe('Wait for me');
    expect(snapshot.turns[0]?.parts.map((part) => part.kind)).toEqual(['tool', 'steer', 'text']);
    expect(snapshot.turns[0]?.parts[1]).toMatchObject({ kind: 'steer', text: 'Also, be brief' });
    // The model saw it after the tool result.
    const { requests } = provider.model({ id: 'scripted' }) as FakeModel;
    const last = requests.at(-1)!.messages;
    const steerAt = last.findIndex((message) => message.role === 'user' && message.source === 'input' && message.parts.some((part) => part.type === 'text' && part.text === 'Also, be brief'));
    const resultAt = last.findIndex((message) => message.parts.some((part) => part.type === 'toolResult'));
    expect(resultAt).toBeGreaterThan(-1);
    expect(steerAt).toBeGreaterThan(resultAt);
  });

  it('a steer the turn settled before becomes a new run with the same text', async () => {
    const gate = gateTool();
    const { chat } = testChat({ script: [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Second run.' }], tools: [gate.tool] });
    const started = await chat.say({ text: 'Wait for me' });
    await gate.entered();
    const steering = chat.say({ sessionId: started.sessionId, text: 'Never mind, start over' });
    // The cancel settles the run with the steer still queued: the harness refuses it not_running.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await chat.cancel(started.sessionId);
    const second = await steering;
    expect(second.steered).toBeUndefined();
    expect(second.runId).not.toBe(started.runId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.turns.map((turn) => [turn.input, turn.state])).toEqual([['Wait for me', 'cancelled'], ['Never mind, start over', 'complete']]);
  });

  it('a steer the turn paused on a decision before taking is held, and goes in ahead of the next model step when the decision resumes it', async () => {
    const gate = gateTool();
    const { tool, executions } = deleteFileTool();
    const { chat, provider } = testChat({
      script: [{ toolCalls: [{ name: 'wait_for', input: {} }, { name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'Brief: done.' }],
      tools: [gate.tool, tool],
    });
    const started = await chat.say({ text: 'Wait, then delete notes.txt' });
    await gate.entered();
    // Typed while the gate holds: the steer waits for the next model step, but the second call asks first.
    const steering = chat.say({ sessionId: started.sessionId, text: 'Also, be brief' });
    gate.release();
    // Paused, and already detached here: `say` resolved once the pause refused the steer.
    expect(await steering).toEqual({ sessionId: started.sessionId, runId: started.runId, held: true });

    // No run was started against the paused one: the confirmation shows, the text waits as a steer.
    const paused = await chat.snapshot(started.sessionId);
    expect(paused.pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'delete_file' } });
    expect(paused.turns.map((turn) => [turn.input, turn.state])).toEqual([['Wait, then delete notes.txt', 'running']]);
    expect(paused.queued).toMatchObject([{ text: 'Also, be brief', steer: true }]);
    expect((await chat.sessions())[0]?.activity).toBe('awaiting');

    await chat.approve(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);
    const done = await chat.snapshot(started.sessionId);
    expect(done.queued).toEqual([]);
    expect(done.turns).toHaveLength(1);
    expect(done.turns[0]?.parts.map((part) => part.kind)).toEqual(['tool', 'tool', 'steer', 'text']);
    // The model read it after both tool results, before answering.
    const { requests } = provider.model({ id: 'scripted' }) as FakeModel;
    const last = requests.at(-1)!.messages;
    const steerAt = last.findIndex((message) => message.role === 'user' && message.parts.some((part) => part.type === 'text' && part.text === 'Also, be brief'));
    const resultAt = last.findIndex((message) => message.parts.some((part) => part.type === 'toolResult'));
    expect(resultAt).toBeGreaterThan(-1);
    expect(steerAt).toBeGreaterThan(resultAt);
  });

  it('a held steer outlives a cancel of the decision as a queued message, and is the next turn once the person speaks again', async () => {
    const gate = gateTool();
    const { tool } = deleteFileTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'wait_for', input: {} }, { name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'Fresh start.' }, { text: 'Brief.' }],
      tools: [gate.tool, tool],
    });
    const started = await chat.say({ text: 'Wait, then delete notes.txt' });
    await gate.entered();
    const steering = chat.say({ sessionId: started.sessionId, text: 'Also, be brief' });
    gate.release();
    expect((await steering).held).toBe(true);
    expect((await chat.sessions())[0]?.activity).toBe('awaiting');

    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    // Held by the cancel, as any queued message is; `unqueue` could drop it here.
    expect((await chat.snapshot(started.sessionId)).queued).toMatchObject([{ text: 'Also, be brief', steer: true }]);

    const next = await chat.say({ sessionId: started.sessionId, text: 'Start over' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.queued).toEqual([]);
    expect(snapshot.turns.map((turn) => [turn.input, turn.state])).toEqual([
      ['Wait, then delete notes.txt', 'cancelled'], ['Start over', 'complete'], ['Also, be brief', 'complete'],
    ]);
    expect(next.runId).not.toBe(started.runId);
  });

  it('a run another process recorded after the paused one does not hide the decision: the writer holder is the turn in force', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat, store } = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }], tools: [tool] });
    const started = await chat.say({ text: 'Delete a' });
    expect((await chat.wait(started.sessionId))?.status).toBe('awaiting');
    // What a collision leaves: a newer run, failed `writer_busy` against the paused one.
    const later = new Date(Date.now() + 1000).toISOString();
    await store.runs.create({ runId: 'stray', sessionId: started.sessionId, agentId: 'papo', status: 'failed', createdAt: later, updatedAt: later, usage: { inputTokens: 0, outputTokens: 0 }, steps: 0, denials: [] });

    expect((await chat.sessions())[0]?.activity).toBe('awaiting');
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.pending).toMatchObject({ kind: 'toolConfirmation' });
    expect(snapshot.running).toBe(true);
    await expect(chat.say({ sessionId: started.sessionId, text: 'hurry' })).rejects.toMatchObject({ code: 'writer_busy' });
    await chat.approve(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);
  });

  it('queues the next turns: the head starts when the turn settles, not after a cancel; unqueue drops one; settings ride along', async () => {
    const gate = gateTool();
    const { chat, provider } = testChat({
      script: [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'One.' }, { text: 'Two.' }, { toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Four.' }],
      tools: [gate.tool],
    });
    const notified: string[] = [];
    chat.subscribe((id) => notified.push(id));
    const started = await chat.say({ text: 'First' });
    await gate.entered();

    const second = await chat.queue({ sessionId: started.sessionId, text: 'Second', settings: { reasoning: 'high' } });
    const dropped = await chat.queue({ sessionId: started.sessionId, text: 'Dropped' });
    await chat.queue({ sessionId: started.sessionId, text: 'Dropped, edited', id: dropped.id });
    expect((await chat.snapshot(started.sessionId)).queued.map((waiting) => waiting.text)).toEqual(['Second', 'Dropped, edited']);
    await chat.unqueue(started.sessionId, dropped.id);
    await expect(chat.unqueue(started.sessionId, dropped.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await chat.queued(started.sessionId)).toEqual([second]);
    expect(notified.filter((id) => id === started.sessionId).length).toBeGreaterThan(0);

    gate.release();
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    // The head started as the next turn, with its settings; `wait` covers the head while it starts.
    expect(await chat.queued(started.sessionId)).toEqual([]);
    await chat.wait(started.sessionId);
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual(['First', 'Second']);
    expect(after.settings.reasoning).toBe('high');
    const { asked } = provider;
    expect(asked.at(-1)?.params?.reasoning).toEqual({ effort: 'high' });

    // Queued, then cancelled: nothing starts; the message keeps waiting until the person speaks again.
    const third = await chat.say({ sessionId: started.sessionId, text: 'Third' });
    await gate.entered();
    await chat.queue({ sessionId: started.sessionId, text: 'Fourth' });
    await chat.cancel(started.sessionId);
    expect((await chat.wait(third.sessionId))?.status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await chat.snapshot(started.sessionId)).queued.map((waiting) => waiting.text)).toEqual(['Fourth']);
    expect(await chat.wait(started.sessionId)).toBeUndefined();
  });

  it('shows the answer as it streams, and only here: the store holds it whole once the step completes', async () => {
    // The stream pauses after its second delta ('Hello '), with the reasoning and the first word in the draft.
    let deltas = 0;
    let paused!: () => void;
    let resume!: () => void;
    const pausedAt = new Promise<void>((resolve) => { paused = resolve; });
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const { chat, store } = testChat({
      script: [{ text: 'Hello back.', reasoning: 'A greeting.', chunks: ['Hello ', 'back.'] }],
      stream: true,
      afterDelta: async () => { deltas += 1; if (deltas === 2) { paused(); await held; } },
    });
    const started = await chat.say({ text: 'Hello there' });
    await pausedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const writing = await chat.snapshot(started.sessionId);
    expect(writing.running).toBe(true);
    expect(writing.turns[0]?.state).toBe('running');
    expect(writing.turns[0]?.parts).toEqual([
      { kind: 'reasoning', id: `${started.runId}:draft:reasoning`, text: 'A greeting.', streaming: true },
      { kind: 'text', id: `${started.runId}:draft:text`, text: 'Hello ', streaming: true },
    ]);
    // Another process on the same store did not run the turn: it sees the text whole at completion, nothing before.
    const other = testChat({ script: [], store });
    expect((await other.chat.snapshot(started.sessionId)).turns[0]?.parts).toEqual([]);

    resume();
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    for (const view of [chat, other.chat]) {
      const done = await view.snapshot(started.sessionId);
      expect(done.turns[0]?.state).toBe('complete');
      expect(done.turns[0]?.parts).toEqual([
        { kind: 'reasoning', id: expect.not.stringContaining(':draft:'), text: 'A greeting.' },
        { kind: 'text', id: expect.not.stringContaining(':draft:'), text: 'Hello back.' },
      ]);
    }
    // The deltas were persisted (decision 102) and papo read nothing back from them.
    const events = await store.runs.listEvents({ sessionId: started.sessionId, runId: started.runId });
    expect(events.filter((event) => event.type === 'model.delta')).toHaveLength(3);
  });

  it('a message queued while nothing runs starts at once, unless a cancel holds the session', async () => {
    const gate = gateTool();
    const { chat } = testChat({ script: [{ text: 'One.' }, { text: 'Two.' }, { toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Four.' }], tools: [gate.tool] });
    const started = await chat.say({ text: 'First' });
    await chat.wait(started.sessionId);

    // Idle: the queue is not a queue at all, the message is the next turn now (the reference's `startNext`).
    const queued = await chat.queue({ sessionId: started.sessionId, text: 'Second' });
    expect(queued.text).toBe('Second');
    expect(await chat.queued(started.sessionId)).toEqual([]);
    expect((await chat.snapshot(started.sessionId)).running).toBe(true);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['First', 'Second']);

    // Cancelled: the session is held; a message queued while it is idle waits until the person speaks.
    await chat.say({ sessionId: started.sessionId, text: 'Third' });
    await gate.entered();
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    await chat.queue({ sessionId: started.sessionId, text: 'Fourth' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await chat.snapshot(started.sessionId)).queued.map((waiting) => waiting.text)).toEqual(['Fourth']);
    expect(await chat.wait(started.sessionId)).toBeUndefined();
  });

  it('a turn a limit stops is failed and says which limit', async () => {
    const gate = gateTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'wait_for', input: {} }, { name: 'wait_for', input: {} }] }],
      tools: [gate.tool],
      config: { limits: { maxToolCalls: 1 } },
    });
    const started = await chat.say({ text: 'Wait twice' });
    await gate.entered();
    gate.release();
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'stopped', reason: 'max_tool_calls' });
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.turns[0]?.state).toBe('failed');
    expect(snapshot.turns[0]?.parts.map((part) => part.kind)).toEqual(['tool', 'tool', 'error']);
    expect(snapshot.turns[0]?.parts[1]).toMatchObject({ call: { status: 'failed', output: 'Tool call limit reached' } });
    expect(snapshot.turns[0]?.parts[2]).toMatchObject({ kind: 'error', message: 'stopped: max_tool_calls' });
    expect((await chat.sessions())[0]?.activity).toBe('idle');
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

  it('lists the providers that answer when another cannot be reached, and names the one asked about', async () => {
    const down: ModelProvider = {
      id: 'down',
      listModels: async () => { throw new Error('connect ECONNREFUSED 10.255.10.10:1235'); },
      model: () => { throw new Error('never asked'); },
    };
    const warned: string[] = [];
    const { chat } = testChat({
      script: ECHO,
      config: { providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1' }, { id: 'local', baseUrl: 'http://10.255.10.10:1235/v1' }] },
      providers: [down],
      warn: (message) => warned.push(message),
    });
    // The whole list: what answers is listed, what does not is said once.
    expect((await chat.models()).map((row) => row.ref)).toEqual(['fake/scripted', 'fake/other']);
    expect(warned).toEqual(['provider "local": connect ECONNREFUSED 10.255.10.10:1235']);
    // One provider: its rows, or its own error.
    expect((await chat.models({ provider: 'fake' })).map((row) => row.ref)).toEqual(['fake/scripted', 'fake/other']);
    await expect(chat.models({ provider: 'local' })).rejects.toThrow('ECONNREFUSED');
    await expect(chat.models({ provider: 'nope' })).rejects.toMatchObject({ code: 'invalid_options', message: 'provider "nope" is not configured; configured: fake, local' });
  });

  it('names a model that is not configured', async () => {
    const { chat } = testChat({ script: ECHO });
    await expect(chat.say({ text: 'x', settings: { model: 'other/m' } })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(chat.say({ text: 'x', settings: { model: 'nomodel' } })).rejects.toMatchObject({ code: 'invalid_options' });
    expect((await chat.models()).map((row) => row.ref)).toEqual(['fake/scripted', 'fake/other']);
  });

  it('starts from the configured defaults and keeps each session own choices', async () => {
    const { chat, provider } = testChat({ script: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], config: { model: undefined } });
    // No model configured: nothing is asked of the provider until a turn needs it.
    expect(await chat.settings()).toEqual({ model: '', permissions: 'default', reasoning: 'off', autoCompact: false });
    expect(provider.asked).toEqual([]);

    const started = await chat.say({ text: 'One', settings: { reasoning: 'high', model: 'fake/other' } });
    await chat.wait(started.sessionId);
    expect(provider.asked.at(-1)).toEqual({ id: 'other', params: { reasoning: { effort: 'high' } } });
    expect((await chat.snapshot(started.sessionId)).settings).toEqual({ model: 'fake/other', permissions: 'default', reasoning: 'high', autoCompact: false });

    await chat.configure(started.sessionId, { reasoning: 'off', permissions: 'acceptEdits' });
    expect(await chat.settings(started.sessionId)).toEqual({ model: 'fake/other', permissions: 'acceptEdits', reasoning: 'off', autoCompact: false });
    await chat.say({ sessionId: started.sessionId, text: 'Two' });
    await chat.wait(started.sessionId);
    expect(provider.asked.at(-1)).toEqual({ id: 'other', params: {} });

    // Another session is untouched by the first one's choices; its model is the first listed, asked once.
    const fresh = await chat.say({ text: 'Three' });
    await chat.wait(fresh.sessionId);
    expect(provider.asked.at(-1)).toEqual({ id: 'scripted', params: {} });
    expect(await chat.settings(fresh.sessionId)).toEqual({ model: 'fake/scripted', permissions: 'default', reasoning: 'off', autoCompact: false });
    expect(await chat.settings()).toEqual({ model: 'fake/scripted', permissions: 'default', reasoning: 'off', autoCompact: false });

    await expect(chat.configure(started.sessionId, { permissions: 'maybe' as never })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(chat.configure('missing', { reasoning: 'low' })).rejects.toMatchObject({ code: 'not_found' });

    // The screen sends what it shows for a new conversation, `model: ''` included: "unset" is a valid word, not a malformed ref.
    const blank = await chat.say({ text: 'Four', settings: { model: '', permissions: 'default', reasoning: 'off', autoCompact: false } });
    expect((await chat.wait(blank.sessionId))?.status).toBe('completed');
    expect(provider.asked.at(-1)).toEqual({ id: 'scripted', params: {} });
    expect(await chat.settings(blank.sessionId)).toEqual({ model: 'fake/scripted', permissions: 'default', reasoning: 'off', autoCompact: false });
    await expect(chat.configure(blank.sessionId, { model: 'nope' })).rejects.toMatchObject({ code: 'invalid_options' });
  });

  it('bypassPermissions runs a destructive tool unasked, but a deny rule from the configuration still refuses it', async () => {
    const { tool, executions } = deleteFileTool();
    const script = [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }];
    const bypass = testChat({ script, tools: [tool] });
    const started = await bypass.chat.say({ text: 'Delete a', settings: { permissions: 'bypassPermissions' } });
    expect((await bypass.chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);

    // Deny and ask rules run before the mode's own answer (Claude's permissions.ts, steps 1a-1f).
    const denied = testChat({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'precious' } }] }, { text: 'Left it.' }], tools: [tool], config: { rules: { deny: [{ tool: 'delete_file', match: 'prec*' }] } } });
    const refused = await denied.chat.say({ text: 'Delete precious', settings: { permissions: 'bypassPermissions' } });
    expect((await denied.chat.wait(refused.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);
    expect((await denied.chat.snapshot(refused.sessionId)).turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed', output: 'Denied by rule: delete_file(prec*)' } });
  });

  it('dontAsk refuses what default would ask, with the reason, and still runs what only reads', async () => {
    const { tool, executions } = deleteFileTool();
    const { chat } = testChat({
      script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'q', question: 'Why?' }] } }] }, { text: 'ok' }],
      tools: [tool],
    });
    const started = await chat.say({ text: 'Delete a, then ask', settings: { permissions: 'dontAsk' } });
    // The deletion is refused without a stop; the question (no declared effect) reaches the person as under default.
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'input' });
    expect(executions()).toBe(0);
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { name: 'delete_file', status: 'failed', output: 'delete_file would need approval and the mode is dontAsk' } });
    expect(snapshot.pending?.kind).toBe('chatInput');
  });

  it('a session allow rule, or "always" on a confirmation, lets a tool default would ask about run unasked', async () => {
    const { tool, executions } = deleteFileTool();
    const script = [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'One.' }, { toolCalls: [{ name: 'delete_file', input: { path: 'b' } }] }, { text: 'Two.' }];
    const ruled = testChat({ script, tools: [tool] });
    const started = await ruled.chat.say({ text: 'Delete a', settings: { rules: { allow: [{ tool: 'delete_file' }] } } });
    expect((await ruled.chat.wait(started.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(1);

    const always = testChat({ script, tools: [tool] });
    const first = await always.chat.say({ text: 'Delete a' });
    expect((await always.chat.wait(first.sessionId))?.status).toBe('awaiting');
    await always.chat.approve(first.sessionId, { always: true });
    expect((await always.chat.wait(first.sessionId))?.status).toBe('completed');
    // The grant is a session allow rule (decision CLI-04.5), not the harness's remembered approval.
    expect((await always.chat.settings(first.sessionId)).rules).toEqual({ allow: [{ tool: 'delete_file' }] });
    await always.chat.say({ sessionId: first.sessionId, text: 'Delete b' });
    expect((await always.chat.wait(first.sessionId))?.status).toBe('completed');
    expect(executions()).toBe(3);
  });

  it('compacts a session into a summary turn the next turn starts from, and refuses while busy', async () => {
    const { tool } = deleteFileTool();
    const { chat, provider, store } = testChat({
      script: [{ text: 'Hello back.' }, { text: 'We greeted each other.' }, { text: 'Still here.' }, { toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }],
      tools: [tool],
    });
    const started = await chat.say({ text: 'Hello there' });
    await chat.wait(started.sessionId);
    const folded = await chat.compact(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    // The screen shows the model's view (cli/03 F1): the compaction's turn first, with the tokens before and after,
    // then the tail the compaction kept verbatim; the ask itself is covered by the summary and gone.
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot.turns.map((turn) => turn.input)).toEqual(['(context compacted)', 'Hello there']);
    expect(snapshot.turns[0]).toMatchObject({ id: folded.runId, state: 'complete', steps: 1, parts: [{ kind: 'summary', text: 'Summary of the conversation so far:\n\nWe greeted each other.', before: expect.any(Number), after: expect.any(Number) }] });
    expect(snapshot.turns[1]).toMatchObject({ id: started.runId, parts: [{ kind: 'text', text: 'Hello back.' }] });
    // `--all`: everything, in the order it happened, the summary inside the compaction run's turn.
    const all = await chat.snapshot(started.sessionId, { all: true });
    expect(all.turns.map((turn) => turn.input)).toEqual(['Hello there', 'Summarize the conversation so far.']);
    expect(all.turns[1]).toMatchObject({ id: folded.runId, parts: [{ kind: 'summary', before: expect.any(Number) }] });
    // A process that did not see the compaction reads the numbers, and the run, from the store's events.
    const other = testChat({ script: [], store });
    expect((await other.chat.snapshot(started.sessionId)).turns[0]).toMatchObject({ id: folded.runId, input: '(context compacted)', parts: [{ kind: 'summary', before: expect.any(Number), after: expect.any(Number) }] });

    await chat.say({ sessionId: started.sessionId, text: 'Again?' });
    await chat.wait(started.sessionId);
    const { requests } = provider.model({ id: 'scripted' }) as FakeModel;
    // The summary first, then the tail a compaction keeps verbatim (agent/01-p5 task 08, cli/03 F1), then the new input.
    expect(requests.at(-1)!.messages.map((m) => m.source)).toEqual(['summary', 'input', 'model', 'input']);

    await chat.say({ sessionId: started.sessionId, text: 'Delete a' });
    expect((await chat.wait(started.sessionId))?.status).toBe('awaiting');
    await expect(chat.compact(started.sessionId)).rejects.toMatchObject({ code: 'writer_busy' });
  });

  it('lists the shipped skills after the home ones, a home skill of the same name winning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'papo-home-'));
    await mkdir(join(home, 'skills', 'review'), { recursive: true });
    await writeFile(join(home, 'skills', 'review', 'SKILL.md'), ['---', 'name: review', 'description: Mine', '---', 'x', ''].join('\n'));
    try {
      const { chat } = testChat({ script: [], home });
      const skills = await chat.skills();
      expect(skills.map((skill) => [skill.name, skill.description])).toEqual([
        ['review', 'Mine'],
        ['init', 'Write or refresh AGENTS.md, the notes an agent needs to work in this repository'],
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('default runs what reads and asks before a write or the network; acceptEdits lets an edit inside the workspace through and asks outside it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'papo-modes-'));
    await writeFile(join(workspace, 'notes.md'), 'hello\n');
    const outside = join(tmpdir(), `papo-outside-${Date.now()}.txt`);
    const config = { tools: { files: true, shell: true, web: true, memory: false } };
    try {
      // default: read_file runs; write_file and web_fetch stop (writes, network); the person denies each.
      const asking = testChat({
        script: [
          { toolCalls: [{ name: 'read_file', input: { path: 'notes.md' } }] },
          { toolCalls: [{ name: 'write_file', input: { path: 'notes.md', content: 'bye' } }] },
          { toolCalls: [{ name: 'web_fetch', input: { url: 'https://example.invalid/' } }] },
          { text: 'Fine.' },
        ],
        config, workspace,
      });
      const started = await asking.chat.say({ text: 'Read, write, fetch' });
      expect(await asking.chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'approval' });
      expect((await asking.chat.snapshot(started.sessionId)).pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'write_file' } });
      await asking.chat.deny(started.sessionId);
      expect(await asking.chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'approval' });
      expect((await asking.chat.snapshot(started.sessionId)).pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'web_fetch' } });
      await asking.chat.deny(started.sessionId);
      expect((await asking.chat.wait(started.sessionId))?.status).toBe('completed');
      expect((await asking.chat.snapshot(started.sessionId)).turns[0]?.parts.map((part) => part.kind === 'tool' ? [part.call.name, part.call.status] : part.kind))
        .toEqual([['read_file', 'completed'], ['write_file', 'failed'], ['web_fetch', 'failed'], 'text']);

      // acceptEdits: the edit inside the workspace runs (a relative path, and one climbing back in); the one outside
      // and the command still ask (decision CLI-04.6; Claude's filesystem.ts).
      const editing = testChat({
        script: [
          { toolCalls: [{ name: 'write_file', input: { path: 'sub/../out.txt', content: 'inside' } }] },
          { toolCalls: [{ name: 'edit_file', input: { path: 'notes.md', old: 'hello', new: 'bye' } }] },
          { toolCalls: [{ name: 'write_file', input: { path: outside, content: 'outside' } }] },
          { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' } }] },
          { text: 'Edited.' },
        ],
        config, workspace,
      });
      const edited = await editing.chat.say({ text: 'Edit', settings: { permissions: 'acceptEdits' } });
      expect(await editing.chat.wait(edited.sessionId)).toMatchObject({ status: 'awaiting', kind: 'approval' });
      expect((await editing.chat.snapshot(edited.sessionId)).pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'write_file', input: expect.stringContaining('outside') } });
      expect(await readFile(join(workspace, 'out.txt'), 'utf8')).toBe('inside');
      expect(await readFile(join(workspace, 'notes.md'), 'utf8')).toBe('bye\n');
      await editing.chat.deny(edited.sessionId);
      expect(await editing.chat.wait(edited.sessionId)).toMatchObject({ status: 'awaiting', kind: 'approval' });
      expect((await editing.chat.snapshot(edited.sessionId)).pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'shell_exec' } });
      await editing.chat.deny(edited.sessionId);
      expect((await editing.chat.wait(edited.sessionId))?.status).toBe('completed');
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  it('gives the agent the standard tools the configuration turns on: read_file answers, shell_exec asks under default and runs under bypassPermissions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'papo-tools-'));
    await writeFile(join(workspace, 'package.json'), '{ "name": "demo" }\n');
    try {
      const reading = testChat({
        script: [{ toolCalls: [{ name: 'read_file', input: { path: 'package.json' } }] }, { text: 'It is demo.' }],
        config: { tools: { files: true, shell: false, web: false, memory: false } },
        workspace,
      });
      const read = await reading.chat.say({ text: 'What is the package name?' });
      expect((await reading.chat.wait(read.sessionId))?.status).toBe('completed');
      const answered = await reading.chat.snapshot(read.sessionId);
      expect(answered.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { name: 'read_file', status: 'completed', output: '1│{ "name": "demo" }' } });
      expect(answered.turns[0]?.parts[1]).toMatchObject({ kind: 'text', text: 'It is demo.' });

      const script = [{ toolCalls: [{ name: 'shell_exec', input: { command: 'echo papo' } }] }, { text: 'Said papo.' }];
      const asking = testChat({ script, config: { tools: { files: false, shell: true, web: false, memory: false } }, workspace });
      const asked = await asking.chat.say({ text: 'Run echo' });
      expect((await asking.chat.wait(asked.sessionId))?.status).toBe('awaiting');
      expect((await asking.chat.snapshot(asked.sessionId)).pending).toMatchObject({ kind: 'toolConfirmation', call: { name: 'shell_exec' } });
      await asking.chat.deny(asked.sessionId);
      expect((await asking.chat.wait(asked.sessionId))?.status).toBe('completed');

      const running = testChat({ script, config: { tools: { files: false, shell: true, web: false, memory: false } }, workspace });
      const ran = await running.chat.say({ text: 'Run echo', settings: { permissions: 'bypassPermissions' } });
      expect((await running.chat.wait(ran.sessionId))?.status).toBe('completed');
      expect((await running.chat.snapshot(ran.sessionId)).turns[0]?.parts[0]).toMatchObject({ call: { name: 'shell_exec', status: 'completed', output: 'exit 0\npapo' } });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
