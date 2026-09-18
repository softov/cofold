import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../testing.js';
import type { Chat } from '../types/chat.js';
import { CLAUDE_PROVIDER, createClaudeChat } from './chat.js';
import { COMPACTED_INPUT } from '../turns.js';
import type { FakeClaudeSdk, FakeReply } from './testing.js';
import { fakeClaudeSdk } from './testing.js';

/** A fresh store root per rig: the file store makes the folders on the first write. */
const freshHome = (): string => join(tmpdir(), `papo-claude-${randomUUID()}`);

function claudeChat(replies: FakeReply[] = [], config: Parameters<typeof testConfig>[0] = { model: undefined }, args: { home?: string; sdk?: FakeClaudeSdk } = {}): { chat: Chat; sdk: FakeClaudeSdk; home: string } {
  const sdk = args.sdk ?? fakeClaudeSdk();
  sdk.replies.push(...replies);
  const home = args.home ?? freshHome();
  const chat = createClaudeChat({ config: testConfig(config), workspace: 'C:\\work', home, sdk, warn: () => {} });
  return { chat, sdk, home };
}

const tick = (ms = 15): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A tool the fake holds until `release` is called: what a message is said during. */
function held(): { waitFor: Promise<string>; release: (output?: string) => void } {
  let release!: (output: string) => void;
  const waitFor = new Promise<string>((resolve) => { release = resolve; });
  return { waitFor, release: (output = 'done') => release(output) };
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

    // What it used, summed from what the CLI reported per turn (CLI-06.1); no price anywhere.
    const used = await chat.usage(started.sessionId);
    expect(used.runs.map((run) => [run.status, run.steps, run.toolCalls, run.denials])).toEqual([['completed', 1, 0, 0], ['completed', 1, 0, 0]]);
    expect(used).toMatchObject({ sessionId: started.sessionId, usage: { inputTokens: 20, outputTokens: 10 }, steps: 2, toolCalls: 0, denials: 0 });
    await expect(chat.usage('nope')).rejects.toMatchObject({ code: 'not_found' });
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

  it("shows the CLI's own sentence as the title, withholds always when the CLI asks, and sends always as a session rule", async () => {
    const userRule = { type: 'addRules' as const, rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow' as const, destination: 'userSettings' as const };
    const { chat, sdk } = claudeChat([
      { tool: 'Bash', input: { command: 'npm test' }, title: 'Claude wants to run npm test', suggestions: [userRule], output: 'ok', then: 'Passed.' },
      { tool: 'Read', input: { file_path: 'a.txt' }, title: 'Claude wants to read a.txt', suggestions: [userRule], suppressAlways: true, output: 'a', then: 'Read.' },
    ]);
    const started = await chat.say({ text: 'Test' });
    await chat.wait(started.sessionId);
    const asked = await chat.snapshot(started.sessionId);
    expect(asked.pending).toMatchObject({ kind: 'toolConfirmation', call: { confirmationTitle: 'Claude wants to run npm test', options: [{ id: 'always' }] } });
    await chat.approve(started.sessionId, { always: true });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(sdk.decisions.at(-1)).toMatchObject({ behavior: 'allow', updatedPermissions: [{ ...userRule, destination: 'session' }] });

    await chat.say({ sessionId: started.sessionId, text: 'Read a' });
    await chat.wait(started.sessionId);
    const withheld = await chat.snapshot(started.sessionId);
    expect(withheld.pending).toMatchObject({ kind: 'toolConfirmation', call: { confirmationTitle: 'Claude wants to read a.txt', options: [] } });
    await chat.approve(started.sessionId, { always: true });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(sdk.decisions.at(-1)).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.txt' } });
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

  it('cancels a running turn through interrupt, and a waiting one by denying its decision and interrupting, as ahpd does', async () => {
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
    // The decision is denied with the harness's words (decision 120) and the CLI interrupted: the turn ends cancelled, nothing runs after it.
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    const cut = await chat.snapshot(started.sessionId);
    expect(cut.running).toBe(false);
    expect(cut.turns[1]?.parts).toMatchObject([
      { kind: 'tool', call: { status: 'failed', output: 'The turn was stopped' } },
      { kind: 'notice', text: 'Request interrupted by user' },
    ]);
  });

  it('fails a turn the CLI ended on an API error, which it reports as a success with is_error', async () => {
    const { chat } = claudeChat([{ apiError: 'API Error: 529 overloaded' }, { text: 'Fine now.' }]);
    const started = await chat.say({ text: 'Go' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'failed', error: { code: 'api_error', message: 'API Error: 529 overloaded' } });
    const failed = await chat.snapshot(started.sessionId);
    expect(failed.turns[0]).toMatchObject({ state: 'failed' });
    expect(failed.turns[0]?.parts.at(-1)).toMatchObject({ kind: 'error', message: 'API Error: 529 overloaded' });
    expect((await chat.sessions())[0]?.activity).toBe('idle');
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
    const { chat } = claudeChat([{ text: 'One.' }, { text: 'Two.' }, { text: 'We counted to two.' }]);
    const started = await chat.say({ text: 'First' });
    await chat.wait(started.sessionId);
    await chat.say({ sessionId: started.sessionId, text: 'Second' });
    await chat.wait(started.sessionId);

    const compacting = await chat.compact(started.sessionId);
    expect(compacting.sessionId).toBe(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual([COMPACTED_INPUT, 'Second', '/compact']);
    expect(after.turns[0]?.parts[0]).toMatchObject({ kind: 'summary', text: 'We counted to two.' });
    expect(after.turns[2]?.parts[0]).toMatchObject({ kind: 'notice', text: 'Compacted' });
    expect(after.settings.autoCompact).toBe(true);
  });

  it('takes a message said while a tool runs into the running turn, as the CLI does, and shows it after the tool result', async () => {
    const gate = held();
    const { chat } = claudeChat([{ tool: 'Bash', input: { command: 'sleep 5' }, waitFor: gate.waitFor, then: 'Done, briefly.' }], { model: undefined, permissions: 'bypassPermissions' });
    const started = await chat.say({ text: 'Run it' });
    await tick();
    expect((await chat.snapshot(started.sessionId)).running).toBe(true);

    const steered = await chat.say({ sessionId: started.sessionId, text: 'Also, be brief' });
    expect(steered).toEqual({ sessionId: started.sessionId, runId: started.runId, steered: true });
    // Shown at once, from what this process pushed; the store has it once the turn ends.
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['Run it', 'Also, be brief']);
    await expect(chat.compact(started.sessionId)).rejects.toMatchObject({ code: 'writer_busy' });

    gate.release('slept');
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    const done = await chat.snapshot(started.sessionId);
    // The CLI records the steer as a user message, so the projection opens a turn at it: after the tool result, before the reply.
    expect(done.turns.map((turn) => [turn.input, turn.parts.map((part) => part.kind)])).toEqual([['Run it', ['tool']], ['Also, be brief', ['text']]]);
    expect(done.turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'completed', output: 'slept' } });
    expect(done.turns[1]?.parts[0]).toMatchObject({ kind: 'text', text: 'Done, briefly.' });
    expect(done.running).toBe(false);
  });

  it('queues the next turn: the head starts when the turn settles and not after a cancel; unqueue drops one', async () => {
    const first = held();
    const third = held();
    const { chat } = claudeChat([
      { tool: 'Bash', input: { command: 'a' }, waitFor: first.waitFor, then: 'One.' },
      { text: 'Two.' },
      { tool: 'Bash', input: { command: 'c' }, waitFor: third.waitFor, then: 'Three.' },
    ], { model: undefined, permissions: 'bypassPermissions' });
    const started = await chat.say({ text: 'First' });
    await tick();
    const second = await chat.queue({ sessionId: started.sessionId, text: 'Second', settings: { model: 'claude/opus' } });
    const dropped = await chat.queue({ sessionId: started.sessionId, text: 'Dropped' });
    expect((await chat.snapshot(started.sessionId)).queued.map((waiting) => waiting.text)).toEqual(['Second', 'Dropped']);
    await chat.unqueue(started.sessionId, dropped.id);
    await expect(chat.unqueue(started.sessionId, dropped.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await chat.queued(started.sessionId)).toEqual([second]);

    first.release('ok');
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect(await chat.queued(started.sessionId)).toEqual([]);
    await chat.wait(started.sessionId);
    const after = await chat.snapshot(started.sessionId);
    expect(after.turns.map((turn) => turn.input)).toEqual(['First', 'Second']);
    expect(after.settings.model).toBe('claude/opus');

    await chat.say({ sessionId: started.sessionId, text: 'Third' });
    await tick();
    await chat.queue({ sessionId: started.sessionId, text: 'Fourth' });
    await chat.cancel(started.sessionId);
    expect((await chat.wait(started.sessionId))?.status).toBe('cancelled');
    await tick();
    const cancelled = await chat.snapshot(started.sessionId);
    expect(cancelled.queued.map((waiting) => waiting.text)).toEqual(['Fourth']);
    expect(cancelled.running).toBe(false);
    expect(cancelled.turns.at(-1)).toMatchObject({ input: 'Third', parts: [{ kind: 'tool', call: { status: 'failed' } }, { kind: 'notice', text: 'Request interrupted by user' }] });
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

  it('removes a session mid-turn without leaving a failed turn behind, and settles whoever waited on it', async () => {
    const { chat, sdk } = claudeChat([{ hang: true }]);
    const started = await chat.say({ text: 'Think forever' });
    const waited = chat.wait(started.sessionId);
    await chat.remove(started.sessionId);
    expect((await waited)?.status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await chat.sessions()).toEqual([]);
    // Were the process's end recorded as the turn's failure, this turn would show it: the prompt lands without a part.
    sdk.store.set(started.sessionId, [{ type: 'user', uuid: 'later', session_id: started.sessionId, message: { role: 'user', content: 'Think forever' }, parent_tool_use_id: null }]);
    expect((await chat.snapshot(started.sessionId)).turns).toMatchObject([{ input: 'Think forever', state: 'complete', parts: [] }]);
  });

  it('shows the prompt once while the CLI has not written it yet, though the stream echoes it', async () => {
    const { chat, sdk } = claudeChat([{ hang: true }]);
    const started = await chat.say({ text: 'Hold on' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing stored yet: the fake writes at the result, as the CLI does; the view is what was streamed.
    expect(sdk.store.has(started.sessionId)).toBe(false);
    const during = await chat.snapshot(started.sessionId);
    expect(during.turns.map((turn) => [turn.input, turn.state])).toEqual([['Hold on', 'running']]);
    expect(during.session).toMatchObject({ title: 'Hold on', activity: 'running' });
    await chat.cancel(started.sessionId);
    await chat.wait(started.sessionId);
    expect((await chat.snapshot(started.sessionId)).turns.map((turn) => turn.input)).toEqual(['Hold on']);
  });

  it("keeps a session's settings in the store under home, where a second papo over the same home reads them", async () => {
    const sdk = fakeClaudeSdk();
    const first = claudeChat([{ text: 'a' }], { model: undefined }, { sdk });
    const started = await first.chat.say({ text: 'One', settings: { model: 'claude/opus', reasoning: 'high' } });
    await first.chat.wait(started.sessionId);
    await first.chat.configure(started.sessionId, { permissions: 'bypassPermissions' });
    await first.chat.close();

    const second = claudeChat([{ text: 'b' }], { model: undefined }, { sdk, home: first.home });
    expect(await second.chat.settings(started.sessionId)).toEqual({ model: 'claude/opus', permissions: 'bypassPermissions', reasoning: 'high', autoCompact: true });
    expect((await second.chat.snapshot(started.sessionId)).settings.permissions).toBe('bypassPermissions');
    await second.chat.say({ sessionId: started.sessionId, text: 'Two' });
    await second.chat.wait(started.sessionId);
    expect(sdk.queries.at(-1)?.options).toMatchObject({ resume: started.sessionId, model: 'opus', effort: 'high' });

    await second.chat.remove(started.sessionId);
    expect(await second.chat.settings(started.sessionId)).toMatchObject({ model: '', permissions: 'default', reasoning: 'off' });
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

  it('under bypassPermissions the CLI asks nobody about a tool, while a question still asks', async () => {
    const { chat } = claudeChat([{ tool: 'Bash', input: { command: 'ls' }, output: 'a b', then: 'Listed.' }, ASK], { model: undefined, permissions: 'bypassPermissions' });
    const started = await chat.say({ text: 'List' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
    expect((await chat.snapshot(started.sessionId)).turns[0]?.parts[0]).toMatchObject({ kind: 'tool', call: { status: 'completed', output: 'a b' } });
    await chat.say({ sessionId: started.sessionId, text: 'Choose' });
    expect(await chat.wait(started.sessionId)).toMatchObject({ status: 'awaiting', kind: 'input' });
    await chat.answer(started.sessionId, { 'Which one?': 'B' });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
  });

  it('takes the first say from the screen, which carries every setting it shows, autoCompact included', async () => {
    const { chat } = claudeChat([{ text: 'Hi.' }]);
    const started = await chat.say({ text: 'Hello', settings: { model: '', permissions: 'default', reasoning: 'off', autoCompact: true } });
    expect((await chat.wait(started.sessionId))?.status).toBe('completed');
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
    expect(await chat.settings()).toMatchObject({ model: '', permissions: 'default', reasoning: 'off' });
    await expect(chat.configure('s', { model: 'fake/x' })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(chat.configure('s', { autoCompact: false })).rejects.toMatchObject({ code: 'invalid_options', message: /compacts on its own/ });

    const started = await chat.say({ text: 'One', settings: { model: 'claude/opus' } });
    await chat.wait(started.sessionId);
    expect(sdk.queries[0]?.options).toMatchObject({ model: 'opus' });
    expect(sdk.queries[0]?.options?.effort).toBeUndefined();

    await chat.configure(started.sessionId, { permissions: 'bypassPermissions' });
    await chat.say({ sessionId: started.sessionId, text: 'Two' });
    await chat.wait(started.sessionId);
    // The mode is a process option (the SDK wants its flag with it): a change means a new process, as an effort change does.
    expect(sdk.queries).toHaveLength(2);
    expect(sdk.queries[1]?.options).toMatchObject({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true });

    await chat.configure(started.sessionId, { reasoning: 'high' });
    await chat.say({ sessionId: started.sessionId, text: 'Three' });
    await chat.wait(started.sessionId);
    expect(sdk.queries).toHaveLength(3);
    expect(sdk.queries[1]?.closed).toBe(true);
    expect(sdk.queries[2]?.options).toMatchObject({ resume: started.sessionId, model: 'opus', effort: 'high', permissionMode: 'bypassPermissions' });
    expect(await chat.settings(started.sessionId)).toMatchObject({ model: 'claude/opus', permissions: 'bypassPermissions', reasoning: 'high' });
  });
});
