import { describe, expect, it } from 'vitest';
import type { Harness } from '@textui/testing';
import { renderApp } from '@textui/testing';
import type { FakeStep } from '@facio/agents/testing';
import type { Tool } from '@facio/agents';
import { deleteFileTool, testChat, testConfig } from '../testing.js';
import { registerPapo } from './app.js';

async function settle(t: Harness, times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await t.settle();
}

async function screen(args: { script: FakeStep[]; tools?: Tool<any, any>[] }): Promise<{ t: Harness; quit: () => boolean }> {
  const { chat } = testChat({ script: args.script, ...(args.tools !== undefined ? { tools: args.tools } : {}) });
  let quit = false;
  const t = await renderApp({
    width: 100,
    height: 30,
    shell: 'workbench',
    theme: 'paper',
    onBoot: (app) => registerPapo(app, {
      papo: { chat, config: testConfig(), workspace: '/work', home: '/nowhere' },
      onQuit: () => { quit = true; },
    }),
  });
  await settle(t);
  return { t, quit: () => quit };
}

describe('the screen', () => {
  it('opens on the catalogue, starts a conversation on n, and shows the reply', async () => {
    const { t } = await screen({ script: [{ text: 'Hello back.' }] });
    expect(t.hasText('No sessions here yet')).toBe(true);
    t.press('n');
    await settle(t);
    expect(t.hasText('A new conversation')).toBe(true);
    t.type('Hello there');
    t.press('enter');
    await settle(t, 30);
    expect(t.hasText('Hello there')).toBe(true);
    expect(t.hasText('Hello back.')).toBe(true);
    // The catalogue knows about it now.
    t.press('escape');
    await settle(t);
    t.press('escape');
    await settle(t);
    expect(t.hasText('1 in this workspace')).toBe(true);
    expect(t.hasText('Hello there')).toBe(true);
    await t.unmount();
  });

  it('shows the confirmation block and approves it with a', async () => {
    const { tool, executions } = deleteFileTool();
    const { t } = await screen({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'Gone.' }], tools: [tool] });
    t.press('n');
    await settle(t);
    t.type('Delete notes.txt');
    t.press('enter');
    await settle(t, 30);
    expect(t.hasText('Run delete_file?')).toBe(true);
    expect(t.hasText('1 waiting on you') || t.hasText('approve')).toBe(true);
    t.press('a');
    await settle(t, 30);
    expect(executions()).toBe(1);
    expect(t.hasText('Gone.')).toBe(true);
    expect(t.hasText('Run delete_file?')).toBe(false);
    await t.unmount();
  });

  it('quits on ctrl+c when nothing is running', async () => {
    const { t, quit } = await screen({ script: [] });
    t.press('ctrl+c');
    await settle(t);
    expect(quit()).toBe(true);
    await t.unmount();
  });
});
