import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { AgentError } from '../errors.js';
import { run } from '../run/run.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import type { CapabilityArgs } from '../types/capability.js';
import type { SkillSource } from '../types/skills.js';
import type { ToolContext } from '../types/tool.js';
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
