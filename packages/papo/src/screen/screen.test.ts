import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Harness } from '@textui/testing';
import { renderApp } from '@textui/testing';
import type { FakeStep } from '@facio/agents/testing';
import type { Tool } from '@facio/agents';
import { deleteFileTool, testChat, testConfig } from '../testing.js';
import { registerPapo } from './app.js';
import { DRAFT } from './state.js';

async function settle(t: Harness, times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await t.settle();
}

async function screen(args: { script: FakeStep[]; tools?: Tool<any, any>[]; home?: string; workspace?: string }): Promise<{ t: Harness; quit: () => boolean }> {
  const workspace = args.workspace ?? '/work';
  const { chat } = testChat({ script: args.script, workspace, ...(args.tools !== undefined ? { tools: args.tools } : {}), ...(args.home !== undefined ? { home: args.home } : {}) });
  let quit = false;
  const t = await renderApp({
    width: 100,
    height: 30,
    shell: 'workbench',
    theme: 'paper',
    onBoot: (app) => registerPapo(app, {
      papo: { chat, config: testConfig(), workspace, home: args.home ?? '/nowhere' },
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

  it('shows the settings as chips, changes one through its picker, and starts the session with it', async () => {
    const { tool, executions } = deleteFileTool();
    const { t } = await screen({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Gone.' }], tools: [tool] });
    t.press('n');
    await settle(t);
    expect(t.hasText('fake/scripted')).toBe(true);
    expect(t.hasText('Ask for destructive tools')).toBe(true);
    expect(t.hasText('No thinking')).toBe(true);
    // Tab to the permissions chip, open it, pick the last answer.
    t.pressAll('tab', 'tab', 'enter');
    await settle(t);
    expect(t.hasText('Never ask')).toBe(true);
    expect(t.hasText('Every tool call runs')).toBe(true);
    t.pressAll('down', 'down', 'enter');
    await settle(t);
    expect(t.hasText('Never ask')).toBe(true);
    expect(t.hasText('Ask for destructive tools')).toBe(false);
    // The choice went with the first message: the destructive tool ran without asking.
    t.app.focus.focus('chat.composer');
    t.type('Delete a');
    t.press('enter');
    await settle(t, 30);
    expect(executions()).toBe(1);
    expect(t.hasText('Gone.')).toBe(true);
    await t.unmount();
  });

  it('offers the skills and the palette commands after a slash: a skill completes the draft, a command runs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'papo-skills-'));
    await mkdir(join(home, 'skills', 'review'), { recursive: true });
    await writeFile(join(home, 'skills', 'review', 'SKILL.md'), ['---', 'name: review', 'description: Review the change', '---', 'Look hard.', ''].join('\n'));
    try {
      const { t, quit } = await screen({ script: [{ text: 'Reviewed.' }], home });
      t.press('n');
      await settle(t);
      t.type('/rev');
      await settle(t);
      expect(t.hasText('Review the change')).toBe(true);
      t.press('enter');
      await settle(t);
      expect(t.hasText('/review')).toBe(true);
      expect(t.hasText('Reviewed.')).toBe(false);
      t.type('the diff');
      t.press('enter');
      await settle(t, 30);
      expect(t.hasText('/review the diff')).toBe(true);
      expect(t.hasText('Reviewed.')).toBe(true);
      t.type('/quit');
      await settle(t);
      expect(t.hasText('Quit')).toBe(true);
      t.press('enter');
      await settle(t);
      expect(quit()).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('answers /status, /cost, /config and /help from the store, in one overlay that esc closes', async () => {
    const { t } = await screen({ script: [{ text: 'Hello back.' }] });
    t.press('n');
    await settle(t);
    t.type('Hello there');
    t.press('enter');
    await settle(t, 30);

    t.type('/status');
    t.press('enter');
    await settle(t);
    expect(t.hasText('model        fake/scripted')).toBe(true);
    expect(t.hasText('turns        1')).toBe(true);
    t.press('escape');
    await settle(t);
    expect(t.hasText('workspace    /work')).toBe(false);

    t.type('/cost');
    t.press('enter');
    await settle(t);
    expect(t.hasText('Hello there')).toBe(true);
    expect(t.hasText('total  ')).toBe(true);
    t.press('escape');
    await settle(t);

    t.type('/config');
    t.press('enter');
    await settle(t);
    expect(t.hasText('"baseUrl": "http://fake.invalid/v1"')).toBe(true);
    t.press('escape');
    await settle(t);

    t.type('/help');
    t.press('enter');
    await settle(t);
    expect(t.hasText('/quit  Quit')).toBe(true);
    expect(t.hasText('ctrl+q')).toBe(true);
    t.press('escape');
    await settle(t);
    await t.unmount();
  });

  it('exports the conversation, retries the last message, clears to a new one, and changes the theme', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'papo-ws-'));
    try {
      const { t } = await screen({ script: [{ text: 'First.' }, { text: 'Second.' }], workspace });
      t.press('n');
      await settle(t);
      t.type('Say it');
      t.press('enter');
      await settle(t, 30);
      expect(t.hasText('First.')).toBe(true);

      t.type('/export');
      t.press('enter');
      await settle(t);
      expect(t.hasText('Written to')).toBe(true);
      const [file] = await readdir(workspace);
      expect(file).toMatch(/^papo-.*\.md$/);
      expect(await readFile(join(workspace, file!), 'utf8')).toContain('## You\n\nSay it\n\n## papo\n\nFirst.');
      t.press('escape');
      await settle(t);

      t.type('/retry');
      t.press('enter');
      await settle(t, 30);
      expect(t.hasText('Second.')).toBe(true);

      t.type('/theme');
      t.press('enter');
      await settle(t);
      t.type('workbench');
      await settle(t);
      t.press('enter');
      await settle(t);
      expect(t.hasText('Second.')).toBe(true);

      t.type('/clear');
      t.press('enter');
      await settle(t);
      expect(t.hasText('A new conversation')).toBe(true);
      expect(t.hasText('Second.')).toBe(false);
      await t.unmount();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('/skill opens a picker of the skills and puts the chosen one in the field', async () => {
    const { t } = await screen({ script: [] });
    t.press('n');
    await settle(t);
    t.type('/skill');
    t.press('enter');
    await settle(t);
    expect(t.hasText('Write or refresh AGENTS.md')).toBe(true);
    t.type('init');
    await settle(t);
    t.press('enter');
    await settle(t);
    expect(t.hasText('/init')).toBe(true);
    expect(t.app.store.get(DRAFT)).toBe('/init ');
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
