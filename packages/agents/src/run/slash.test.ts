import type { RunEvent } from '../types/event.js';
import type { FakeStep } from '../types/testing.js';
import type { SlashCommand, SlashCommandContext } from '../types/slash-command.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { AgentError } from '../errors.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { run } from './run.js';
import { listSlashCommands, parseSlash } from './slash.js';

function build(args: { script?: FakeStep[]; store?: ReturnType<typeof createMemoryStore>; slashCommands?: SlashCommand[] } = {}) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script ?? [] });
  const agent = createAgent({
    id: 'a', instructions: 'be brief', model, store,
    context: { maxTokens: 10_000, compactKeepTokens: 0 },
    ...(args.slashCommands ? { slashCommands: args.slashCommands } : {}),
  });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);

describe('parseSlash', () => {
  it('reads a name and its arguments from a string or one text part, and nothing else', () => {
    expect(parseSlash('/compact')).toEqual({ name: 'compact', args: '' });
    expect(parseSlash('/review  pr 12\nwith care')).toEqual({ name: 'review', args: 'pr 12\nwith care' });
    expect(parseSlash([{ type: 'text', text: '/status' }])).toEqual({ name: 'status', args: '' });
    expect(parseSlash('/Status')).toBeUndefined();
    expect(parseSlash('/status: now')).toBeUndefined();
    expect(parseSlash(' /status')).toBeUndefined();
    expect(parseSlash('status')).toBeUndefined();
    expect(parseSlash([{ type: 'text', text: '/status' }, { type: 'image', mimeType: 'image/png', data: 'AA' }])).toBeUndefined();
  });
});

describe('runtime commands', () => {
  it('a program command writes command and notice, emits both events in order, and makes no model request', async () => {
    const seen: SlashCommandContext[] = [];
    const status: SlashCommand = { name: 'status', description: 'Show the session', run: async (ctx) => { seen.push(ctx); return `session ${ctx.sessionId}: ${ctx.args}`; } };
    const { agent, model, store } = build({ slashCommands: [status] });
    const handle = run({ agent, session: 's', workspace: 'W', input: '/status all of it' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual(['run.started', 'command.started', 'command.finished', 'run.finished']);
    expect(events[1]).toMatchObject({ name: 'status', args: 'all of it' });
    expect(events[2]).toMatchObject({ name: 'status', output: 'session s: all of it' });
    expect(model.requests).toHaveLength(0);
    expect(outcome).toMatchObject({ status: 'completed', steps: 0, message: { source: 'notice' } });
    expect(seen[0]).toMatchObject({ sessionId: 's', runId: handle.runId, workspace: 'W', args: 'all of it', store });
    expect(seen[0]!.agent).toBe(agent);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => [m.source, textOf(m)])).toEqual([['command', '/status all of it'], ['notice', 'session s: all of it']]);
    expect(await store.runs.listSteps({ sessionId: 's', runId: handle.runId })).toHaveLength(0);
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
  });

  it('a command that returns nothing writes no notice and completes with the command message', async () => {
    const quiet: SlashCommand = { name: 'quiet', description: 'Say nothing', run: async () => undefined };
    const { agent, store } = build({ slashCommands: [quiet] });
    const handle = run({ agent, session: 's', input: '/quiet' });
    const events = await collect(handle);
    expect(events[2]).toEqual(expect.not.objectContaining({ output: expect.anything() }));
    expect(await handle.outcome).toMatchObject({ status: 'completed', message: { source: 'command' } });
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.source)).toEqual(['command']);
  });

  it('a command that throws ends the run failed with no notice', async () => {
    const broken: SlashCommand = { name: 'broken', description: 'Fails', run: async () => { throw new Error('no way'); } };
    const { agent, store } = build({ slashCommands: [broken] });
    const handle = run({ agent, session: 's', input: '/broken' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'command.started', 'run.finished']);
    expect(await handle.outcome).toMatchObject({ status: 'failed', error: { code: 'command_error', message: '/broken: no way' } });
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.source)).toEqual(['command']);
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
  });

  it('/unknown x goes to the model as text', async () => {
    const { agent, model, store } = build({ script: [{ text: 'What is /unknown?' }] });
    const handle = run({ agent, session: 's', input: '/unknown x' });
    const events = await collect(handle);
    expect(types(events)).not.toContain('command.started');
    expect(await handle.outcome).toMatchObject({ status: 'completed' });
    expect(model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([['input', '/unknown x']]);
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.source)).toEqual(['input', 'model']);
  });

  it('a later request carries neither the command nor the notice', async () => {
    const status: SlashCommand = { name: 'status', description: 'Show the session', run: async () => 'all good' };
    const store = createMemoryStore();
    await collect(run({ agent: build({ store, script: [{ text: 'Hello.' }] }).agent, session: 's', input: 'Hi' }));
    await collect(run({ agent: build({ store, slashCommands: [status] }).agent, session: 's', input: '/status' }));
    const next = build({ store, script: [{ text: 'Still here.' }] });
    await collect(run({ agent: next.agent, session: 's', input: 'Again?' }));
    expect(next.model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([['input', 'Hi'], ['model', 'Hello.'], ['input', 'Again?']]);
  });
});

describe('/compact', () => {
  it('writes command, summary and notice, and its one request has the new ask as its last message', async () => {
    const store = createMemoryStore();
    await collect(run({ agent: build({ store, script: [{ text: 'Hello.' }] }).agent, session: 's', input: 'Hi' }));
    const compacting = build({ store, script: [{ text: 'They greeted.' }] });
    const handle = run({ agent: compacting.agent, session: 's', input: '/compact' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual(['run.started', 'command.started', 'model.started', 'model.completed', 'context.compacted', 'command.finished', 'run.finished']);
    expect(events[5]).toMatchObject({ name: 'compact', output: 'Compacted' });
    // One model call: the run counts its step and its usage.
    expect(outcome).toMatchObject({ status: 'completed', steps: 1, message: { source: 'summary' } });
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
    expect(compacting.model.requests).toHaveLength(1);
    expect(compacting.model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([
      ['input', 'Hi'], ['model', 'Hello.'], ['system', 'Summarize the conversation so far.'],
    ]);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.source)).toEqual(['input', 'model', 'command', 'summary', 'notice']);
    expect(transcript[3]!.summarizes).toEqual(transcript.slice(0, 3).map((m) => m.id));

    const next = build({ store, script: [{ text: 'Still here.' }] });
    await collect(run({ agent: next.agent, session: 's', input: 'Again?' }));
    expect(next.model.requests[0]!.messages.map((m) => m.source)).toEqual(['summary', 'input']);
  });
});

describe('the command list', () => {
  const noop = (name: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({ name, description: `${name} it`, run: async () => undefined, ...extra });

  it('joins the options, the capabilities and the built-ins, in that order', () => {
    const { agent } = build({ slashCommands: [noop('status', { argumentHint: '[all]' })] });
    expect(listSlashCommands(agent).map((c) => c.name)).toEqual(['status', 'compact']);
    const withCap = createAgent({
      id: 'a', instructions: 'x', model: createFakeModel({ script: [] }), store: createMemoryStore(),
      slashCommands: [noop('status')],
      capabilities: [{ id: 'mem', slashCommands: [noop('memory')] }],
    });
    expect(listSlashCommands(withCap)).toEqual([
      { name: 'status', description: 'status it', kind: 'runtime' },
      { name: 'memory', description: 'memory it', kind: 'runtime' },
      { name: 'compact', description: expect.any(String), kind: 'runtime' },
    ]);
    expect(listSlashCommands(agent)[0]).toEqual({ name: 'status', description: 'status it', argumentHint: '[all]', kind: 'runtime' });
  });

  it('fails createAgent with invalid_options on a duplicate name or a bad one', () => {
    const model = createFakeModel({ script: [] });
    const store = createMemoryStore();
    const attempt = (options: Partial<Parameters<typeof createAgent>[0]>) => {
      try { createAgent({ id: 'a', instructions: 'x', model, store, ...options }); }
      catch (e) { return e; }
      return undefined;
    };
    for (const options of [
      { slashCommands: [noop('status'), noop('status')] },
      { slashCommands: [noop('compact')] },
      { slashCommands: [noop('status')], capabilities: [{ id: 'c', slashCommands: [noop('status')] }] },
      { slashCommands: [noop('Status')] },
      { slashCommands: [noop('-x')] },
    ]) {
      const e = attempt(options);
      expect(e).toBeInstanceOf(AgentError);
      expect((e as AgentError).code).toBe('invalid_options');
    }
  });
});
