import type { Capability } from '../types/capability.js';
import type { FakeStep } from '../types/testing.js';
import type { Store } from '../types/store.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { resume } from './resume.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };

function tool(name: string, over: { deferred?: boolean; destructive?: boolean; description?: string; execute?: (i: { text: string }) => string } = {}): Tool<any, any> {
  return createTool<{ text: string }>({
    name,
    description: over.description ?? `${name} does its thing. And then some more words about it.`,
    input: textInput,
    ...(over.deferred !== undefined ? { deferred: over.deferred } : {}),
    ...(over.destructive ? { effects: { destructive: true } } : {}),
    execute: over.execute ?? ((i) => `${name}:${i.text}`),
  });
}

function capability(id: string, tools: Tool<any, any>[], defer?: Capability['defer']): Capability {
  return { id, ...(defer !== undefined ? { defer } : {}), tools: () => tools };
}

function build(args: { script: FakeStep[]; tools?: Tool<any, any>[]; capabilities?: Capability[]; store?: Store }) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: args.tools ?? [], ...(args.capabilities ? { capabilities: args.capabilities } : {}) });
  return { agent, model, store };
}

const toolNames = (request: { tools?: { name: string }[] } | undefined) => (request?.tools ?? []).map((t) => t.name);
const finish = async (handle: ReturnType<typeof run>) => { for await (const _ of handle.events) { /* drain */ } return handle.outcome; };
const call = (name: string, text = 'x'): FakeStep => ({ toolCalls: [{ name, input: { text } }] });

describe('deferred tools: the request and the index', () => {
  it('sends the definitions of the non-deferred tools plus load_tools, and one index line per deferred tool', async () => {
    const { agent, model } = build({ script: [{ text: 'ok' }], tools: [tool('plain'), tool('later', { deferred: true, description: 'Does a later thing. The rest is not shown.' })] });
    expect(agent.definition.deferred).toEqual(['later']);
    await finish(run({ agent, session: 's', input: 'hi' }));
    expect(toolNames(model.requests[0])).toEqual(['plain', 'load_tools']);
    expect(model.requests[0]!.instructions).toBe('be brief\n\n## tools\nThese tools exist but their definitions are not loaded. Call load_tools with their names, or a query, to get the definitions before using one; do not guess their arguments.\n\n- later: Does a later thing.');
  });

  it('a capability defers every tool with true, and those past the first N with { over: N }; without deferral there is no load_tools and no section', async () => {
    const every = build({ script: [{ text: 'ok' }], capabilities: [capability('mcp', [tool('a'), tool('b')], true)] });
    await finish(run({ agent: every.agent, session: 's', input: 'hi' }));
    expect(toolNames(every.model.requests[0])).toEqual(['load_tools']);
    expect(every.model.requests[0]!.instructions).toContain('- a: a does its thing.\n- b: b does its thing.');

    const past = build({ script: [{ text: 'ok' }], capabilities: [capability('mcp', [tool('a'), tool('b')], { over: 1 })] });
    await finish(run({ agent: past.agent, session: 's', input: 'hi' }));
    expect(toolNames(past.model.requests[0])).toEqual(['a', 'load_tools']);
    expect(past.model.requests[0]!.instructions).toContain('- b: b does its thing.');
    expect(past.model.requests[0]!.instructions).not.toContain('- a:');

    const none = build({ script: [{ text: 'ok' }], tools: [tool('plain')], capabilities: [capability('mcp', [tool('a')])] });
    await finish(run({ agent: none.agent, session: 's', input: 'hi' }));
    expect(toolNames(none.model.requests[0])).toEqual(['plain', 'a']);
    expect(none.model.requests[0]!.instructions).toBe('be brief');
  });

  it('refuses a capability that contributes load_tools', async () => {
    const { agent } = build({ script: [{ text: 'ok' }], capabilities: [capability('mcp', [tool('load_tools')])] });
    const outcome = await finish(run({ agent, session: 's', input: 'hi' }));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'invalid_options', message: 'capability "mcp" contributes a duplicate tool "load_tools"' } });
  });
});

describe('load_tools and the session memory of it', () => {
  it('loads by names: the next request carries the definition, the section drops the line, the tool runs; a second run on the session starts loaded', async () => {
    const store = createMemoryStore();
    const tools = [tool('plain'), tool('later', { deferred: true }), tool('other', { deferred: true })];
    const first = build({ store, tools, script: [{ toolCalls: [{ name: 'load_tools', input: { names: ['later', 'nope'] } }] }, call('later'), { text: 'done' }] });
    const outcome = await finish(run({ agent: first.agent, session: 's', input: 'hi' }));
    expect(outcome.status).toBe('completed');
    expect(toolNames(first.model.requests[0])).toEqual(['plain', 'load_tools']);
    expect(toolNames(first.model.requests[1])).toEqual(['plain', 'later', 'load_tools']);
    expect(first.model.requests[1]!.instructions).toContain('- other:');
    expect(first.model.requests[1]!.instructions).not.toContain('- later:');
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    const loadResult = transcript[2]!.parts[0] as { content: string; isError: boolean };
    expect(loadResult.isError).toBe(false);
    expect(loadResult.content).toMatch(/^Loaded: later\n\n\[\n {2}\{\n {4}"name": "later",/);
    expect(loadResult.content).toMatch(/\n\nUnknown: nope$/);
    expect((transcript[4]!.parts[0] as { content: string }).content).toBe('later:x');
    expect(await store.kv({ kind: 'agent', agentId: 'a' }).get('loaded-tools/s')).toEqual(['later']);

    const second = build({ store, tools, script: [{ text: 'again' }] });
    await finish(run({ agent: second.agent, session: 's', input: 'more' }));
    expect(toolNames(second.model.requests[0])).toEqual(['plain', 'later', 'load_tools']);

    const fresh = build({ store, tools, script: [{ text: 'new' }] });
    await finish(run({ agent: fresh.agent, session: 'other-session', input: 'hi' }));
    expect(toolNames(fresh.model.requests[0])).toEqual(['plain', 'load_tools']);
  });

  it('answers a query with the matching definitions, at most ten, and the index with no arguments', async () => {
    const many = Array.from({ length: 12 }, (_, i) => tool(`search_${i}`, { deferred: true, description: `Search kind ${i} of the web.` }));
    const { agent, store } = build({
      tools: [...many, tool('write_note', { deferred: true, description: 'Write a note.' })],
      script: [
        { toolCalls: [{ name: 'load_tools', input: { query: 'search WEB' } }] },
        { toolCalls: [{ name: 'load_tools', input: { query: 'nothing here' } }] },
        { toolCalls: [{ name: 'load_tools', input: {} }] },
        { text: 'done' },
      ],
    });
    await finish(run({ agent, session: 's', input: 'hi' }));
    const results = (await store.sessions.listMessages({ sessionId: 's' })).filter((m) => m.role === 'tool').map((m) => (m.parts[0] as { content: string }).content);
    expect(results[0]).toMatch(/^Loaded: search_0, search_1, search_2, search_3, search_4, search_5, search_6, search_7, search_8, search_9\n\n\[/);
    expect(results[1]).toBe('No deferred tool matches "nothing here".');
    expect(results[2]).toBe('Deferred tools, not loaded:\n- search_10: Search kind 10 of the web.\n- search_11: Search kind 11 of the web.\n- write_note: Write a note.\n\nLoaded this session: search_0, search_1, search_2, search_3, search_4, search_5, search_6, search_7, search_8, search_9');
  });

  it('a valid call to an unloaded deferred tool executes and loads it; an invalid one is denied as before', async () => {
    const execute = vi.fn((i: { text: string }) => `ran:${i.text}`);
    const { agent, model, store } = build({
      tools: [tool('later', { deferred: true, execute })],
      script: [{ toolCalls: [{ name: 'later', input: { text: 3 } }] }, call('later', 'remembered'), { text: 'done' }],
    });
    const outcome = await finish(run({ agent, session: 's', input: 'hi' }));
    expect(outcome.status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(toolNames(model.requests[1])).toEqual(['load_tools']);
    expect(toolNames(model.requests[2])).toEqual(['later', 'load_tools']);
    expect(await store.kv({ kind: 'agent', agentId: 'a' }).get('loaded-tools/s')).toEqual(['later']);
  });

  it('a resumed run keeps what was loaded before the pause', async () => {
    const store = createMemoryStore();
    const tools = [tool('rm', { deferred: true, destructive: true })];
    const paused = build({ store, tools, script: [{ toolCalls: [{ name: 'load_tools', input: { names: ['rm'] } }] }, call('rm'), { text: 'done' }] });
    const first = run({ agent: paused.agent, session: 's', input: 'hi' });
    const outcome = await finish(first);
    if (outcome.status !== 'awaiting') throw new Error(outcome.status);

    const resumed = build({ store, tools, script: [{ text: 'done' }] });
    const handle = resume({ agent: resumed.agent, sessionId: 's', runId: first.runId });
    await handle.submit({ type: 'approve', requestId: outcome.requestId });
    expect((await finish(handle)).status).toBe('completed');
    expect(toolNames(resumed.model.requests[0])).toEqual(['rm', 'load_tools']);
    expect(resumed.model.requests[0]!.instructions).toBe('be brief');
  });
});
