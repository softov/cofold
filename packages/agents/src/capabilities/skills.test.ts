import type { CapabilityArgs } from '../types/capability.js';
import type { SkillSource } from '../types/skills.js';
import type { SlashCommand } from '../types/slash-command.js';
import type { ToolContext } from '../types/tool.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { AgentError } from '../errors.js';
import { textOf } from '../message/helpers.js';
import { run } from '../run/run.js';
import { listPromptCommands } from '../run/slash.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { skills } from './skills.js';

function memorySource(entries: Record<string, { description: string; body: string; files?: Record<string, string> }>): SkillSource {
  return {
    async list({ workspace }) {
      return Object.entries(entries).map(([name, e]) => ({ name, description: e.description, ref: `${workspace ?? 'global'}:${name}` }));
    },
    async read({ ref, path }) {
      const name = ref.slice(ref.lastIndexOf(':') + 1);
      const e = entries[name];
      if (!e) throw new AgentError({ code: 'not_found', message: ref });
      if (path === undefined) return e.body;
      const file = e.files?.[path];
      if (file === undefined) throw new AgentError({ code: 'not_found', message: `${path} in ${ref}` });
      return file;
    },
  };
}

const store = createMemoryStore();
const args: CapabilityArgs = {
  agentId: 'a', sessionId: 's', runId: 'r', workspace: 'F:/proj', signal: new AbortController().signal,
  kv: { agent: store.kv({ kind: 'agent', agentId: 'a' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) },
};
const ctx = {} as ToolContext;

describe('skills()', () => {
  it('requires a source and renders the rules plus one line per skill', async () => {
    expect(() => skills({ sources: [] })).toThrow(AgentError);
    const cap = skills({ sources: [memorySource({ deploy: { description: 'Ship it', body: 'x' }, review: { description: 'Review a PR', body: 'y' } })] });
    expect(cap.id).toBe('skills');
    const text = await cap.instructions!(args);
    expect(text).toContain('read_skill({ name })');
    expect(text).not.toContain('/<name>');
    expect(text?.endsWith('\n\n- deploy: Ship it\n- review: Review a PR')).toBe(true);
    expect(await skills({ sources: [memorySource({})] }).instructions!(args)).toBeUndefined();
  });

  it('first source wins on a duplicate name and warns once', async () => {
    const warn = vi.fn();
    const a = memorySource({ deploy: { description: 'from a', body: 'A' } });
    const b = memorySource({ deploy: { description: 'from b', body: 'B' }, other: { description: 'o', body: 'O' } });
    const cap = skills({ sources: [a, b], warn });
    expect(await cap.instructions!(args)).toContain('- deploy: from a\n- other: o');
    const [tool] = await cap.tools!(args);
    expect(await tool!.execute({ name: 'deploy' }, ctx)).toBe('A');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/duplicate skill "deploy"/);
  });

  it('read_skill returns the body or a file beside it and passes the workspace to the source', async () => {
    const list = vi.fn(async ({ workspace }: { workspace?: string }) => [{ name: 'deploy', description: 'd', ref: `${workspace}:deploy` }]);
    const source: SkillSource = { list, read: memorySource({ deploy: { description: 'd', body: 'BODY', files: { 'references/a.md': 'REF' } } }).read };
    const [tool] = await skills({ sources: [source] }).tools!(args);
    expect(list).toHaveBeenCalledWith({ workspace: 'F:/proj' });
    expect(tool).toMatchObject({ name: 'read_skill', effects: { reads: true } });
    expect(await tool!.execute({ name: 'deploy' }, ctx)).toBe('BODY');
    expect(await tool!.execute({ name: 'deploy', path: 'references/a.md' }, ctx)).toBe('REF');
    await expect(tool!.execute({ name: 'nope' }, ctx)).rejects.toThrow('unknown skill "nope"');
  });

  it('contributes to a run: instructions section, read_skill result and an error result for an unknown name', async () => {
    const model = createFakeModel({ script: [
      { toolCalls: [{ name: 'read_skill', input: { name: 'deploy' } }, { name: 'read_skill', input: { name: 'nope' } }] },
      { text: 'done' },
    ] });
    const agent = createAgent({
      id: 'a', instructions: 'be brief', model, store: createMemoryStore(),
      capabilities: [skills({ sources: [memorySource({ deploy: { description: 'Ship it', body: 'Run the checklist.' } })] })],
    });
    const handle = run({ agent, session: 's', input: 'deploy' });
    expect((await handle.outcome).status).toBe('completed');
    expect(model.requests[0]!.instructions).toMatch(/^be brief\n\n## skills\nA skill is a set of instructions/);
    expect(model.requests[0]!.instructions.endsWith('- deploy: Ship it')).toBe(true);
    expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(['read_skill']);
    const results = model.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) => m.parts[0]);
    expect(results[0]).toMatchObject({ type: 'toolResult', content: 'Run the checklist.', isError: false });
    expect(results[1]).toMatchObject({ type: 'toolResult', content: 'unknown skill "nope"', isError: true });
    const steps = await agent.store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'read_skill', status: 'completed' });
    expect(steps[2]).toMatchObject({ kind: 'tool', name: 'read_skill', status: 'failed' });
  });
});

describe('skills as prompt commands (AGENT-03)', () => {
  const sources = () => [memorySource({ review: { description: 'Review a PR', body: 'Read the diff.\n' }, deploy: { description: 'Ship it', body: 'Run the checklist.' } })];

  it('/review x writes an input and a skill message, and the first request carries both', async () => {
    const model = createFakeModel({ script: [{ text: 'Reviewing.' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store: createMemoryStore(), capabilities: [skills({ sources: sources() })] });
    const handle = run({ agent, session: 's', input: '/review x' });
    expect(await handle.outcome).toMatchObject({ status: 'completed', steps: 1 });
    const transcript = await agent.store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => [m.role, m.source])).toEqual([['user', 'input'], ['user', 'skill'], ['assistant', 'model']]);
    expect(textOf(transcript[0]!)).toBe('/review x');
    expect(textOf(transcript[1]!)).toBe('<skill name="review">\nRead the diff.\n</skill>\n\nx');
    expect(model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([['input', '/review x'], ['skill', textOf(transcript[1]!)]]);
  });

  it('a skill with no arguments expands to the skill alone', async () => {
    const [deploy] = (await skills({ sources: sources() }).prompts!({})).filter((c) => c.name === 'deploy');
    expect(await deploy!.expand('')).toBe('<skill name="deploy">\nRun the checklist.\n</skill>');
  });

  it('a name that is a runtime command and a skill runs the runtime command', async () => {
    const model = createFakeModel({ script: [] });
    const review: SlashCommand = { name: 'review', description: 'The runtime one', run: async () => 'ran' };
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store: createMemoryStore(), slashCommands: [review], capabilities: [skills({ sources: sources() })] });
    const handle = run({ agent, session: 's', input: '/review x' });
    expect(await handle.outcome).toMatchObject({ status: 'completed', steps: 0 });
    expect(model.requests).toHaveLength(0);
    expect((await agent.store.sessions.listMessages({ sessionId: 's' })).map((m) => m.source)).toEqual(['command', 'notice']);
  });

  it('listPromptCommands lists each skill once, with its description, for the workspace', async () => {
    const list = vi.fn(async ({ workspace }: { workspace?: string }) => [
      { name: 'review', description: 'Review a PR', ref: `${workspace}:review` },
      { name: 'Upper', description: 'Not a command name', ref: `${workspace}:Upper` },
    ]);
    const other = memorySource({ review: { description: 'from b', body: 'B' } });
    const agent = createAgent({
      id: 'a', instructions: 'x', model: createFakeModel({ script: [] }), store: createMemoryStore(),
      capabilities: [skills({ sources: [{ list, read: other.read }, other] })],
    });
    expect(await listPromptCommands(agent, { workspace: 'W' })).toEqual([{ name: 'review', description: 'Review a PR', kind: 'prompt' }]);
    expect(list).toHaveBeenCalledWith({ workspace: 'W' });
  });

  it('a skill that does not expand is told to warn, and the turn goes on without it', async () => {
    const warn = vi.fn();
    const broken: SkillSource = { list: async () => [{ name: 'review', description: 'd', ref: 'r' }], read: async () => { throw new Error('gone'); } };
    const model = createFakeModel({ script: [{ text: 'ok' }] });
    const agent = createAgent({ id: 'a', instructions: 'x', model, store: createMemoryStore(), warn, capabilities: [skills({ sources: [broken] })] });
    expect(await run({ agent, session: 's', input: '/review x' }).outcome).toMatchObject({ status: 'completed' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/review'));
    expect(warn.mock.calls[0]![0]).toContain('gone');
    expect(model.requests[0]!.messages.map((m) => m.source)).toEqual(['input']);
  });

  it('an auto-compaction before the first step keeps the skill with its input', async () => {
    const store = createMemoryStore();
    const long = 'x'.repeat(400);
    const first = createAgent({ id: 'a', instructions: 'x', model: createFakeModel({ script: [{ text: long }] }), store });
    await run({ agent: first, session: 's', input: long }).outcome;
    const model = createFakeModel({ script: [{ text: 'Folded.' }, { text: 'Reviewing.' }] });
    const agent = createAgent({
      id: 'a', instructions: 'x', model, store, capabilities: [skills({ sources: sources() })],
      context: { maxTokens: 10_000, autoCompactTokens: 150, compactKeepTokens: 0 },
    });
    expect(await run({ agent, session: 's', input: '/review x' }).outcome).toMatchObject({ status: 'completed', steps: 2 });
    expect(model.requests[1]!.messages.map((m) => m.source)).toEqual(['summary', 'input', 'skill']);
  });
});
