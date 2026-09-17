import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FakeStep } from '@facio/agents/testing';
import { toBlocks } from './blocks.js';
import { createClaudeChat } from './claude/chat.js';
import type { FakeReply } from './claude/testing.js';
import { fakeClaudeSdk } from './claude/testing.js';
import { deleteFileTool, gateTool, testChat, testConfig } from './testing.js';
import type { Chat } from './types/chat.js';

/** What the model does on each turn of a story, told the same way to both runtimes; `wait` runs a tool held until `release`. */
type Beat = 'text' | 'tool' | 'ask' | 'wait';

interface Rig {
  name: string;
  open(story: Beat[]): { chat: Chat; release(): void };
}

const QUESTION = 'Which one?';
const tick = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The harness in this process, over a scripted model and the memory store. */
const facio: Rig = {
  name: 'facio',
  open(story) {
    const { tool } = deleteFileTool();
    const gate = gateTool();
    const script: FakeStep[] = story.flatMap((beat): FakeStep[] => {
      if (beat === 'text') return [{ text: 'Reply.' }];
      if (beat === 'tool') return [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Done.' }];
      if (beat === 'wait') return [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Done.' }];
      return [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'which', question: QUESTION, options: [{ label: 'A' }, { label: 'B' }] }] } }] }, { text: 'Done.' }];
    });
    return { chat: testChat({ script, tools: [tool, gate.tool] }).chat, release: () => gate.release('waited') };
  },
};

/** Claude Code's runtime, faked at the SDK: the same story as the CLI would tell it. */
const claude: Rig = {
  name: 'claude',
  open(story) {
    const sdk = fakeClaudeSdk();
    let release!: (output: string) => void;
    const waitFor = new Promise<string>((resolve) => { release = resolve; });
    sdk.replies = story.map((beat): FakeReply => {
      if (beat === 'text') return { text: 'Reply.' };
      if (beat === 'tool') return { tool: 'Bash', input: { command: 'rm a' }, output: 'deleted a', then: 'Done.' };
      if (beat === 'wait') return { tool: 'Bash', input: { command: 'sleep 5' }, waitFor, then: 'Done.' };
      return { tool: 'AskUserQuestion', input: { questions: [{ question: QUESTION, header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] }, then: 'Done.' };
    });
    const chat = createClaudeChat({ config: testConfig({ model: undefined }), workspace: 'C:\\work', home: join(tmpdir(), `papo-contract-${randomUUID()}`), sdk, warn: () => {} });
    return { chat, release: () => release('waited') };
  },
};

/**
 * What a `Snapshot` says for the same story must not depend on the runtime (CLI-03 decision 10).
 * Where the two disagree the harness is presumed wrong; the plan's findings list says what is open.
 */
describe.each([facio, claude])('the chat contract on $name', (rig) => {
  it('say: a session appears, idle, with one complete turn of text', async () => {
    const { chat } = rig.open(['text', 'text']);
    const started = await chat.say({ text: 'Hello there' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(await chat.wait(started.sessionId)).toBeUndefined();
    expect(await chat.sessions()).toMatchObject([{ id: started.sessionId, title: 'Hello there', activity: 'idle' }]);
    const snapshot = await chat.snapshot(started.sessionId);
    expect(snapshot).toMatchObject({ running: false, pending: null, turns: [{ input: 'Hello there', state: 'complete', parts: [{ kind: 'text', text: 'Reply.' }] }] });
    expect(snapshot.turns[0]?.steps).toBe(1);

    await chat.say({ sessionId: started.sessionId, text: 'Again' });
    await chat.wait(started.sessionId);
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['Hello there', 'Again']);
    await chat.close();
  });

  it('approve: the turn waits on the confirmation, refuses another say, and completes once approved', async () => {
    const { chat } = rig.open(['tool']);
    const started = await chat.say({ text: 'Delete a' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'approval' });
    expect((await chat.sessions())[0]?.activity).toBe('awaiting');
    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.running).toBe(true);
    // The runtime's own sentence when it sends one, else the tool's name as a question; both backends name the tool.
    expect(waiting.pending).toMatchObject({ kind: 'toolConfirmation', call: { status: 'pending-confirmation', confirmationTitle: expect.stringMatching(/^Run (delete_file|Bash)\?$/) } });
    expect(waiting.turns[0]).toMatchObject({ state: 'running', parts: [{ kind: 'tool', call: { status: 'pending-confirmation' } }] });
    await expect(chat.say({ sessionId: started.sessionId, text: 'hurry' })).rejects.toMatchObject({ code: 'writer_busy' });
    await expect(chat.answer(started.sessionId, {})).rejects.toMatchObject({ code: 'invalid_options' });

    await chat.approve(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done).toMatchObject({ running: false, pending: null });
    expect(done.turns[0]).toMatchObject({ state: 'complete', parts: [{ kind: 'tool', call: { status: 'completed', output: 'deleted a' } }, { kind: 'text', text: 'Done.' }] });
    await expect(chat.approve(started.sessionId)).rejects.toMatchObject({ code: 'not_found' });
    await chat.close();
  });

  it('deny: the tool fails with the reason and the turn goes on', async () => {
    const { chat } = rig.open(['tool']);
    const started = await chat.say({ text: 'Delete a' });
    await chat.wait(started.sessionId);
    await chat.deny(started.sessionId, { reason: 'Not that one.' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed', output: expect.stringContaining('Not that one.') } });
    expect(done.turns[0]?.parts[1]).toMatchObject({ kind: 'text' });
    await chat.close();
  });

  it('ask: the question form shows the options and the answer completes the tool', async () => {
    const { chat } = rig.open(['ask']);
    const started = await chat.say({ text: 'Choose' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'input' });
    const waiting = await chat.snapshot(started.sessionId);
    expect(waiting.pending).toMatchObject({ kind: 'chatInput', questions: [{ kind: 'single-select', options: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], allowFreeformInput: true }] });
    const question = (waiting.pending as { questions: { id: string; message: string }[] }).questions[0]!;
    expect(question.message).toContain(QUESTION);
    await chat.answer(started.sessionId, { [question.id]: 'A' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'completed', output: expect.stringContaining('A') } });
    expect(done.turns[0]?.parts[1]).toMatchObject({ kind: 'text', text: 'Done.' });
    await chat.close();
  });

  it('cancel: a waiting confirmation is denied and the turn ends cancelled with its marker; deny declines a waiting question', async () => {
    const { chat } = rig.open(['tool']);
    const started = await chat.say({ text: 'Delete a' });
    await chat.wait(started.sessionId);
    await chat.cancel(started.sessionId);
    // Decision 120 on the harness, ahpd's cancel on the CLI: the request is denied "The turn was stopped", nothing runs after it.
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    const stopped = await chat.snapshot(started.sessionId);
    expect(stopped).toMatchObject({ running: false, pending: null });
    expect(stopped.turns[0]?.parts).toMatchObject([
      { kind: 'tool', call: { status: 'failed', output: expect.stringContaining('The turn was stopped') } },
      { kind: 'notice', text: 'Request interrupted by user' },
    ]);

    await chat.close();

    // A cancelled turn never reaches its reply, so the question gets a story of its own.
    const asking = rig.open(['ask']).chat;
    const question = await asking.say({ text: 'Choose' });
    await asking.wait(question.sessionId);
    await asking.deny(question.sessionId);
    expect((await asking.wait(question.sessionId))?.status).toBe('completed');
    const declined = await asking.snapshot(question.sessionId);
    expect(declined.pending).toBeNull();
    expect(declined.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'failed', output: 'The user declined to answer' } });
    await asking.close();
  });

  it('compact: a summary turn appears, the next turn goes on from it, and a busy session refuses', async () => {
    const { chat } = rig.open(['text', 'text', 'text', 'tool']);
    const started = await chat.say({ text: 'Hello there' });
    await chat.wait(started.sessionId);
    const folded = await chat.compact(started.sessionId);
    expect(folded.sessionId).toBe(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const after = await chat.snapshot(started.sessionId);
    expect(after.running).toBe(false);
    expect(after.turns.flatMap((turn) => turn.parts).filter((part) => part.kind === 'summary')).toHaveLength(1);

    await chat.say({ sessionId: started.sessionId, text: 'Again' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect((await chat.snapshot(started.sessionId)).turns.at(-1)).toMatchObject({ input: 'Again', state: 'complete' });

    await chat.say({ sessionId: started.sessionId, text: 'Delete a' });
    await chat.wait(started.sessionId);
    await expect(chat.compact(started.sessionId)).rejects.toMatchObject({ code: 'writer_busy' });
    await chat.close();
  });

  it('remove: the session is gone from the list and from snapshot', async () => {
    const { chat } = rig.open(['text']);
    const started = await chat.say({ text: 'Hello' });
    await chat.wait(started.sessionId);
    await chat.remove(started.sessionId);
    expect(await chat.sessions()).toEqual([]);
    await expect(chat.snapshot(started.sessionId)).rejects.toMatchObject({ code: 'not_found' });
    await chat.close();
  });

  it('steer: a message said while a tool runs lands after the tool result, and the turn goes on to its reply', async () => {
    const { chat, release } = rig.open(['wait']);
    const started = await chat.say({ text: 'Wait', settings: { permissions: 'bypassPermissions' } });
    await tick();
    expect((await chat.snapshot(started.sessionId)).running).toBe(true);
    const steering = chat.say({ sessionId: started.sessionId, text: 'Also this' });
    await tick();
    release();
    expect(await steering).toEqual({ sessionId: started.sessionId, runId: started.runId, steered: true });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    // In transcript order on both: the prompt, the tool with its result, what was said meanwhile, the reply.
    const blocks = toBlocks(done.turns).filter((block) => block.kind === 'said' || block.kind === 'tool' || block.kind === 'prose');
    expect(blocks.map((block) => block.kind)).toEqual(['said', 'tool', 'said', 'prose']);
    expect(blocks[0]).toMatchObject({ text: 'Wait' });
    expect(blocks[1]).toMatchObject({ call: { status: 'completed', output: 'waited' } });
    expect(blocks[2]).toMatchObject({ text: 'Also this' });
    expect(blocks[3]).toMatchObject({ content: 'Done.' });
    await chat.close();
  });

  it('queue: the head starts when the turn settles, never after a cancel; unqueue drops one', async () => {
    const { chat, release } = rig.open(['wait', 'text']);
    const started = await chat.say({ text: 'Wait', settings: { permissions: 'bypassPermissions' } });
    await tick();
    const next = await chat.queue({ sessionId: started.sessionId, text: 'Next' });
    const dropped = await chat.queue({ sessionId: started.sessionId, text: 'Dropped' });
    expect((await chat.snapshot(started.sessionId)).queued).toEqual([next, dropped]);
    await chat.unqueue(started.sessionId, dropped.id);
    await expect(chat.unqueue(started.sessionId, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    expect(await chat.queued(started.sessionId)).toEqual([next]);

    release();
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    await tick();
    expect(await chat.queued(started.sessionId)).toEqual([]);
    await chat.wait(started.sessionId);
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual(['Wait', 'Next']);
    expect(after.turns.at(-1)).toMatchObject({ state: 'complete', parts: [{ kind: 'text', text: 'Reply.' }] });
    await chat.close();
  });

  it('queue while idle: the message is the next turn at once', async () => {
    const { chat } = rig.open(['text', 'text']);
    const started = await chat.say({ text: 'Hello' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    await chat.queue({ sessionId: started.sessionId, text: 'Next' });
    expect(await chat.queued(started.sessionId)).toEqual([]);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual(['Hello', 'Next']);
    expect(after.turns.at(-1)).toMatchObject({ state: 'complete', parts: [{ kind: 'text', text: 'Reply.' }] });
    await chat.close();
  });

  it('queue after cancel: what waits stays waiting', async () => {
    const { chat } = rig.open(['wait']);
    const started = await chat.say({ text: 'Wait', settings: { permissions: 'bypassPermissions' } });
    await tick();
    await chat.queue({ sessionId: started.sessionId, text: 'Later' });
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    await tick();
    const after = await chat.snapshot(started.sessionId);
    expect(after.running).toBe(false);
    expect(after.queued.map((waiting) => waiting.text)).toEqual(['Later']);
    expect(after.turns).toHaveLength(1);
    await chat.close();
  });

  it('settings: the session keeps its own over the defaults, and a wrong word is refused', async () => {
    const { chat } = rig.open(['text']);
    const started = await chat.say({ text: 'Hello', settings: { reasoning: 'high' } });
    await chat.wait(started.sessionId);
    expect((await chat.settings(started.sessionId)).reasoning).toBe('high');
    expect((await chat.settings()).reasoning).toBe('off');
    await expect(chat.configure(started.sessionId, { permissions: 'sometimes' as 'default' })).rejects.toMatchObject({ code: 'invalid_options' });
    expect((await chat.configure(started.sessionId, { permissions: 'bypassPermissions' })).permissions).toBe('bypassPermissions');
    expect((await chat.snapshot(started.sessionId)).settings.permissions).toBe('bypassPermissions');
    // The rule lists are settings too, kept per session on both backends (decision CLI-04.5).
    expect((await chat.configure(started.sessionId, { rules: { deny: [{ tool: 'shell_exec', match: 'rm *' }] } })).rules).toEqual({ deny: [{ tool: 'shell_exec', match: 'rm *' }] });
    await expect(chat.configure(started.sessionId, { rules: { allow: [{ tool: '' }] } })).rejects.toMatchObject({ code: 'invalid_options' });
    await chat.close();
  });
});
