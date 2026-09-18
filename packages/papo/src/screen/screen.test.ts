import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Harness } from '@textui/testing';
import { renderApp } from '@textui/testing';
import type { FakeStep } from '@facio/agents/testing';
import type { ModelProvider, Tool } from '@facio/agents';
import { createMemoryStore } from '@facio/agents';
import { createChat } from '../chat.js';
import { rememberInto } from '../commands.js';
import { deleteFileTool, fakeProvider, gateTool, testChat, testConfig } from '../testing.js';
import { registerPapo } from './app.js';
import { DRAFT, OPEN } from './state.js';

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
      // A no-op `remember`: the machine's own configuration file is not these tests' to write; the one that writes builds its own papo.
      papo: { chat, config: testConfig(), workspace, home: args.home ?? '/nowhere', remember: async () => [] },
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
    expect(t.hasText('Ask before changes')).toBe(true);
    expect(t.hasText('No thinking')).toBe(true);
    // Tab to the permissions chip, open it, pick the third answer: Claude's four modes (cli/03 F8).
    t.pressAll('tab', 'tab', 'enter');
    await settle(t);
    expect(t.hasText('Bypass permissions')).toBe(true);
    expect(t.hasText('Every tool call runs')).toBe(true);
    expect(t.hasText("Don't ask")).toBe(true);
    t.pressAll('down', 'down', 'enter');
    await settle(t);
    expect(t.hasText('Bypass permissions')).toBe(true);
    expect(t.hasText('Ask before changes')).toBe(false);
    // The choice went with the first message: the destructive tool ran without asking.
    t.app.focus.focus('chat.composer');
    t.type('Delete a');
    t.press('enter');
    await settle(t, 30);
    expect(executions()).toBe(1);
    expect(t.hasText('Gone.')).toBe(true);
    await t.unmount();
  });

  it('with one provider the model chip lists its models at once', async () => {
    const { t } = await screen({ script: [{ text: 'Hi.' }] });
    t.press('n');
    await settle(t);
    // The model chip is the first one; enter opens its picker. One provider is no question, so the models come first.
    t.pressAll('tab', 'enter');
    await settle(t);
    expect(t.hasText('The other one')).toBe(true);
    t.pressAll('down', 'enter');
    await settle(t);
    expect(t.hasText('fake/other')).toBe(true);
    expect(t.hasText('fake/scripted')).toBe(false);
    await t.unmount();
  });

  it('with two providers the model chip asks the provider, then lists that provider\'s models only', async () => {
    const script: FakeStep[] = [{ text: 'Hi.' }];
    const config = testConfig({ providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1' }, { id: 'second', baseUrl: 'http://second.invalid/v1' }] });
    const chat = createChat({
      store: createMemoryStore(), config, providers: [fakeProvider(script), fakeProvider(script, 'brain')], workspace: '/work', home: '/nowhere', warn: () => {},
    });
    const t = await renderApp({
      width: 100,
      height: 30,
      shell: 'workbench',
      theme: 'paper',
      onBoot: (app) => registerPapo(app, { papo: { chat, config, workspace: '/work', home: '/nowhere', remember: async () => [] }, onQuit: () => undefined }),
    });
    await settle(t);
    t.press('n');
    await settle(t);
    t.pressAll('tab', 'enter');
    await settle(t);
    // The providers, and none of the models yet.
    expect(t.hasText('second')).toBe(true);
    expect(t.hasText('brain')).toBe(false);
    expect(t.hasText('The other one')).toBe(false);
    t.pressAll('down', 'enter');
    await settle(t);
    // The second provider's two models. Both providers list an "other" model; one row for it means one provider's.
    expect(t.hasText('brain')).toBe(true);
    expect(t.lines().filter((line) => line.includes('The other one'))).toHaveLength(1);
    t.press('enter');
    await settle(t);
    expect(t.hasText('second/brain')).toBe(true);
    await t.unmount();
  });

  it('a provider that is down is still offered, says why when chosen, and does not hide the other one', async () => {
    const down: ModelProvider = {
      id: 'down',
      listModels: async () => { throw new Error('connect ECONNREFUSED 10.255.10.10:1235'); },
      model: () => { throw new Error('never asked'); },
    };
    const config = testConfig({ providers: [{ id: 'local', baseUrl: 'http://10.255.10.10:1235/v1' }, { id: 'fake', baseUrl: 'http://fake.invalid/v1' }] });
    const chat = createChat({
      store: createMemoryStore(), config, providers: [down, fakeProvider([{ text: 'Hi.' }])], workspace: '/work', home: '/nowhere', warn: () => {},
    });
    const t = await renderApp({
      width: 100,
      height: 30,
      shell: 'workbench',
      theme: 'paper',
      onBoot: (app) => registerPapo(app, { papo: { chat, config, workspace: '/work', home: '/nowhere', remember: async () => [] }, onQuit: () => undefined }),
    });
    await settle(t);
    t.press('n');
    await settle(t);
    t.pressAll('tab', 'enter');
    await settle(t);
    // Both providers, the dead one first as configured; nothing was asked of either yet.
    expect(t.hasText('local')).toBe(true);
    expect(t.hasText('fake')).toBe(true);
    // The dead one (the picker opens on the current model's provider, the live one, so one step up): its error on the status row, nothing to choose.
    t.pressAll('up', 'enter');
    await settle(t);
    expect(t.hasText('ECONNREFUSED')).toBe(true);
    expect(t.hasText('The other one')).toBe(false);
    // Escape is one question back: the providers again, and the live one lists as if the other did not exist.
    t.press('escape');
    await settle(t);
    expect(t.hasText('Which provider')).toBe(true);
    // The highlight opens on the provider in force, which is the live one.
    t.press('enter');
    await settle(t);
    expect(t.hasText('The other one')).toBe(true);
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

  it('while a turn runs, enter steers it and the Queue chip holds the draft as the next turn, shown as a queued row', async () => {
    const gate = gateTool();
    const { t } = await screen({
      script: [{ toolCalls: [{ name: 'wait_for', input: {} }] }, { text: 'Heard you.' }, { text: 'Next one done.' }],
      tools: [gate.tool],
    });
    t.press('n');
    await settle(t);
    t.type('Wait for me');
    t.press('enter');
    await gate.entered();
    await settle(t);
    expect(t.hasText('wait_for')).toBe(true);

    // The chip row leads with Queue while running; tab reaches it, enter queues the draft.
    t.type('Next one');
    t.pressAll('tab', 'enter');
    await settle(t);
    expect(t.hasText('queued')).toBe(true);
    expect(t.hasText('Next one')).toBe(true);
    expect(t.hasText('1 queued')).toBe(true);

    // Enter on the composer steers: the message lands in the running turn.
    t.app.focus.focus('chat.composer');
    t.type('Also, be brief');
    t.press('enter');
    await settle(t);
    gate.release();
    await settle(t, 40);
    expect(t.hasText('Also, be brief')).toBe(true);
    expect(t.hasText('Heard you.')).toBe(true);
    // The head started as the next turn once the first settled.
    expect(t.hasText('Next one done.')).toBe(true);
    expect(t.hasText('1 queued')).toBe(false);
    await t.unmount();
  });

  it('heads the conversation with what the session is: title and state, settings, place, when, id, turns and tokens (CLI-06.2)', async () => {
    const { t } = await screen({ script: [{ text: 'Hello back.' }] });
    t.press('n');
    await settle(t);
    expect(t.hasText('A new conversation. Say something below.')).toBe(true);
    expect(t.hasText('Session')).toBe(false);
    t.type('Hello there');
    t.press('enter');
    await settle(t, 30);
    const shown = t.text();
    const id = t.app.store.get<string>(OPEN) ?? '';
    expect(id).not.toBe('');
    for (const piece of ['Hello there', 'idle', 'fake/scripted', 'Permissions', 'Ask before changes', 'Thinking     No thinking', 'Auto-compact off', 'Turns        1', 'Tokens       1 in, 1 out', 'Home         /nowhere', 'Workspace    /work', 'Started', `Session      ${id}`]) {
      expect(shown, piece).toContain(piece);
    }
    expect(shown).not.toContain('A new conversation.');
    await t.unmount();
  });

  it('answers /status, /usage, /config and /help from the store, in one overlay that esc closes', async () => {
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

    t.type('/usage');
    t.press('enter');
    await settle(t);
    // The runtime's table: the turn's row, the sums, and what was asked; never a price.
    console.log('USAGE', t.text());
    expect(t.hasText('Hello there')).toBe(true);
    expect(t.hasText('turn')).toBe(true);
    expect(t.hasText('total')).toBe(true);
    expect(t.hasText('refused')).toBe(true);
    expect(t.hasText('$')).toBe(false);
    expect(t.hasText('Cost')).toBe(false);
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

  it('/compact folds the conversation into a summary turn and /autocompact toggles the setting', async () => {
    const { t } = await screen({ script: [{ text: 'Hello back.' }, { text: 'We said hello.' }] });
    t.press('n');
    await settle(t);
    t.type('Hello there');
    t.press('enter');
    await settle(t, 30);
    t.type('/compact');
    t.press('enter');
    await settle(t, 30);
    // The model's view: the compaction turn first, with the tokens before and after, then the tail it kept verbatim.
    expect(t.hasText('(context compacted)')).toBe(true);
    expect(t.hasText('Context compacted:')).toBe(true);
    expect(t.hasText('tokens to')).toBe(true);
    expect(t.hasText('We said hello.')).toBe(true);
    expect(t.hasText('Hello back.')).toBe(true);

    t.type('/status');
    t.press('enter');
    await settle(t);
    expect(t.hasText('auto-compact off')).toBe(true);
    t.press('escape');
    await settle(t);
    t.type('/autocompact');
    t.press('enter');
    await settle(t);
    t.type('/status');
    t.press('enter');
    await settle(t);
    expect(t.hasText('auto-compact on, at 25600 of 32000 tokens')).toBe(true);
    t.press('escape');
    await settle(t);
    await t.unmount();
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

  it('remembers a chip\'s pick in the configuration file, and the next new conversation starts from it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papo-screen-remember-'));
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(root, 'config') };
    const file = join(root, 'config', 'papo', 'config.json');
    try {
      // What `openPapo` builds: one `config` the chat reads and `remember` writes, over a temp home so the machine's own file is untouched.
      const config = testConfig();
      const chat = createChat({ store: createMemoryStore(), config, providers: [fakeProvider([])], workspace: root, home: '/nowhere', warn: () => {} });
      const t = await renderApp({
        width: 100,
        height: 30,
        shell: 'workbench',
        theme: 'paper',
        onBoot: (app) => registerPapo(app, { papo: { chat, config, workspace: root, home: '/nowhere', remember: rememberInto({ config, cwd: root, env }) }, onQuit: () => undefined }),
      });
      await settle(t);
      t.press('n');
      await settle(t);
      expect(t.hasText('Ask before changes')).toBe(true);
      // The permissions chip, third answer (decision CLI-05.1: every chip pick is written back).
      t.pressAll('tab', 'tab', 'enter');
      await settle(t);
      t.pressAll('down', 'down', 'enter');
      await settle(t);
      expect(t.hasText('Bypass permissions')).toBe(true);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ permissions: 'bypassPermissions' });
      expect(config.permissions).toBe('bypassPermissions');
      // Back to the catalogue and into another new conversation: it starts from the remembered mode, not the built-in default.
      // Three steps out: the picker closed onto the chip, escape there is back to the field, the field's is the transcript, and the transcript's is the screen.
      t.pressAll('escape', 'escape', 'escape');
      await settle(t);
      expect(t.hasText('No sessions here yet')).toBe(true);
      t.press('n');
      await settle(t);
      expect(t.hasText('Bypass permissions')).toBe(true);
      expect(t.hasText('Ask before changes')).toBe(false);
      await t.unmount();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
