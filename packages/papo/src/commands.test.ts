import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Io } from '@facio/commands';
import { exitCodeFor } from '@facio/commands';
import type { ModelProvider, Store } from '@facio/agents';
import { createMemoryStore } from '@facio/agents';
import type { FakeStep } from '@facio/agents/testing';
import { createClaudeChat } from './claude/chat.js';
import type { FakeReply } from './claude/testing.js';
import { fakeClaudeSdk } from './claude/testing.js';
import { createChat } from './chat.js';
import type { Papo } from './commands.js';
import { rememberInto } from './commands.js';
import { loadConfig } from './config.js';
import { argvFor, createProgram } from './program.js';
import { deleteFileTool, fakeProvider, testChat, testConfig } from './testing.js';

interface Ran { code: number; out: string; err: string }

/** A program over the memory store and a scripted model, with its output captured. */
function shell(args: { script: FakeStep[]; store?: Store; tools?: ReturnType<typeof deleteFileTool>['tool'][]; open?: (globals: Readonly<Record<string, unknown>>) => Papo }) {
  const store = args.store ?? createMemoryStore();
  let out = '';
  let err = '';
  const io: Io = { out: (text) => { out += text; }, err: (text) => { err += text; } };
  const program = createProgram({
    io,
    open: args.open ?? ((globals) => {
      const { chat } = testChat({ script: args.script, store, ...(args.tools !== undefined ? { tools: args.tools } : {}), workspace: String(globals['workspace'] ?? '/work') });
      // A no-op `remember`: these tests are about the sessions, and the machine's own configuration file is not theirs to write.
      return { chat, config: testConfig({ providers: [] }), workspace: '/work', home: '/nowhere', remember: async () => [] };
    }),
  });
  // What `runEntry` does around the binary: a fault becomes a sentence on stderr and an exit code.
  const run = async (...argv: string[]): Promise<Ran> => {
    out = ''; err = '';
    let code: number;
    try {
      code = await program.run(argvFor(program, argv));
    } catch (error: unknown) {
      err += `papo: ${error instanceof Error ? error.message : String(error)}
`;
      code = exitCodeFor(error);
    }
    return { code, out, err };
  };
  return { run, store, program };
}

describe('the shell', () => {
  it('says, lists, shows and deletes', async () => {
    const { run } = shell({ script: [{ text: 'Hello back.' }, { text: 'Again.' }] });
    const said = await run('say', 'Hello there', '--json');
    expect(said.code).toBe(0);
    const { sessionId, outcome } = JSON.parse(said.out) as { sessionId: string; outcome: { status: string } };
    expect(outcome.status).toBe('completed');

    const plain = await run('say', '-s', sessionId, 'And again');
    expect(plain.code).toBe(0);
    expect(plain.out).toBe(`Again.\nsession ${sessionId}\n`);

    const listed = await run('session', 'list', '--json');
    expect(JSON.parse(listed.out)).toMatchObject([{ id: sessionId, title: 'Hello there', activity: 'idle' }]);
    const table = await run('session', 'list');
    expect(table.out).toContain('Hello there');

    const shown = await run('session', 'show', sessionId);
    expect(shown.out).toContain('> Hello there');
    expect(shown.out).toContain('Hello back.');
    expect(shown.out).toContain('> And again');

    // What it used, from the runtime's records: two turns, one model step each, no tools, no price.
    const used = await run('usage', sessionId, '--json');
    expect(used.code).toBe(0);
    expect(JSON.parse(used.out)).toMatchObject({ sessionId, steps: 2, toolCalls: 0, denials: 0, runs: [{ status: 'completed', steps: 1 }, { status: 'completed', steps: 1 }] });
    const usage = await run('usage', sessionId);
    expect(usage.out).toContain('turn');
    expect(usage.out).toContain('total');
    expect(usage.out).not.toContain('$');
    const nobody = await run('usage', 'nope');
    expect(nobody.code).not.toBe(0);
    expect(nobody.err).toContain('is not there');

    const exported = await run('session', 'export', sessionId, '-o', join(tmpdir(), `papo-export-${sessionId}.md`));
    expect(exported.code).toBe(0);
    const file = exported.out.trim();
    expect(await readFile(file, 'utf8')).toContain('## You\n\nHello there\n\n## papo\n\nHello back.');
    await rm(file);

    const removed = await run('session', 'delete', sessionId);
    expect(removed.code).toBe(0);
    const gone = await run('session', 'show', sessionId);
    expect(gone.code).not.toBe(0);
    expect(gone.err).toContain('is not there');
  });

  it('stops at a confirmation and says how to answer it; approve finishes the turn', async () => {
    const { tool, executions } = deleteFileTool();
    const { run } = shell({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'notes.txt' } }] }, { text: 'Gone.' }], tools: [tool] });
    const said = await run('say', 'Delete notes.txt');
    expect(said.code).toBe(0);
    expect(said.out).toContain('Waiting: Run delete_file?');
    expect(said.out).toContain('papo approve');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1];
    expect(sessionId).toBeDefined();

    const busy = await run('say', '-s', sessionId!, 'hurry');
    expect(busy.code).not.toBe(0);
    expect(busy.err).toContain('waiting on a decision');

    const approved = await run('approve', sessionId!);
    expect(approved.code).toBe(0);
    expect(approved.out).toContain('[completed] delete_file');
    expect(approved.out).toContain('Gone.');
    expect(executions()).toBe(1);
  });

  it('on the claude backend, say denies every decision the turn stops at and prints where it got to', async () => {
    const sdk = fakeClaudeSdk();
    const replies: FakeReply[] = [{ tool: 'Bash', input: { command: 'ls' }, then: { tool: 'Write', input: { file_path: 'a.txt', content: 'x' }, then: 'Written.' } }];
    sdk.replies.push(...replies);
    const home = join(tmpdir(), `papo-shell-claude-${Date.now()}`);
    const { run } = shell({
      script: [],
      open: () => {
        const config = testConfig({ model: undefined, backend: 'claude', providers: [] });
        return { chat: createClaudeChat({ config, workspace: 'C:\\work', home, sdk, warn: () => {} }), config, workspace: 'C:\\work', home, remember: async () => [] };
      },
    });
    const said = await run('say', 'List, then write');
    expect(said.code).toBe(0);
    expect(sdk.decisions).toHaveLength(2);
    expect(sdk.decisions.every((decision) => decision.behavior === 'deny')).toBe(true);
    expect(said.out).toContain('[failed] Bash');
    expect(said.out).toContain('[failed] Write');
    expect(said.out).toContain('Understood: papo say exited before the decision was made');
    expect(said.out).toContain('Note: papo say cannot hold a decision on the claude backend');
    expect(said.out).not.toContain('Waiting:');
  });

  it('queues a message for a session that waits on a decision, lists it under the transcript, drops it, and starts it once the turn ends', async () => {
    const { tool } = deleteFileTool();
    const { run } = shell({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Gone.' }, { text: 'Then this too.' }], tools: [tool] });
    const said = await run('say', 'Delete a');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;
    expect(said.out).toContain('Waiting: Run delete_file?');

    // Not idle (a decision waits), so the message waits its turn; on an idle session it would start at once.
    const queued = await run('queue', sessionId, 'And then this', '-t', 'high', '--json');
    expect(queued.code).toBe(0);
    const record = JSON.parse(queued.out) as { id: string; text: string; settings?: { reasoning?: string }; at: string };
    expect(record).toMatchObject({ text: 'And then this', settings: { reasoning: 'high' } });

    const shown = await run('session', 'show', sessionId);
    expect(shown.out).toContain('Queued:');
    expect(shown.out).toContain(`  ${record.id}  And then this`);

    const edited = await run('queue', sessionId, 'And then that', '-i', record.id);
    expect(edited.out).toBe(`Queued ${record.id}\n`);
    expect((await run('session', 'show', sessionId)).out).toContain('And then that');

    const dropped = await run('unqueue', sessionId, record.id);
    expect(dropped.code).toBe(0);
    expect(dropped.out).toBe(`Dropped ${record.id}\n`);
    expect((await run('session', 'show', sessionId)).out).not.toContain('Queued:');
    const again = await run('unqueue', sessionId, record.id);
    expect(again.code).not.toBe(0);
    expect(again.err).toContain('nothing queued');
    const missing = await run('queue', 'nope', 'x');
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain('is not there');

    // Queued again, then the decision: the turn ends and the head is the next turn.
    await run('queue', sessionId, 'And then this');
    expect((await run('approve', sessionId)).out).toContain('Gone.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await run('session', 'show', sessionId);
    expect(after.out).toContain('> And then this');
    expect(after.out).toContain('Then this too.');
    expect(after.out).not.toContain('Queued:');
  });

  it('answers a question from id=value words', async () => {
    const { run } = shell({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'scope', question: 'Which?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true }] } }] }, { text: 'Thanks.' }] });
    const said = await run('say', 'Ask me');
    expect(said.out).toContain('scope: Which?');
    expect(said.out).toContain('a | b');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;
    const bad = await run('answer', sessionId, 'scope');
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain('id=value');
    const answered = await run('answer', sessionId, 'scope=a', 'scope=b');
    expect(answered.code).toBe(0);
    expect(answered.out).toContain('Thanks.');
  });

  it('carries settings on say, changes them with session set, and shows them', async () => {
    const { tool, executions } = deleteFileTool();
    const { run } = shell({ script: [{ toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Gone.' }, { text: 'Again.' }], tools: [tool] });
    const said = await run('say', '-p', 'bypassPermissions', '-t', 'high', 'Delete a');
    expect(said.code).toBe(0);
    expect(said.out).toContain('Gone.');
    expect(executions()).toBe(1);
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;

    const shown = await run('session', 'show', sessionId);
    expect(shown.out).toContain('model fake/scripted · permissions bypassPermissions · reasoning high');

    const set = await run('session', 'set', sessionId, '-m', 'fake/other', '-t', 'off', '-a', 'on');
    expect(set.code).toBe(0);
    expect(set.out).toBe('model fake/other · permissions bypassPermissions · reasoning off · autocompact on\n');
    const nothing = await run('session', 'set', sessionId);
    expect(nothing.code).not.toBe(0);
    expect(nothing.err).toContain('nothing to set');
    const wrong = await run('say', '-s', sessionId, '-p', 'sometimes', 'x');
    expect(wrong.code).not.toBe(0);
    expect(wrong.err).toContain('permissions must be one of');
  });

  it('adds rules to a session with --deny, --ask and --allow, lists them with the mode and the configuration\'s, and a session allow rule lets a tool run unasked', async () => {
    const { tool, executions } = deleteFileTool();
    const { run } = shell({ script: [{ text: 'Hi.' }, { toolCalls: [{ name: 'delete_file', input: { path: 'a' } }] }, { text: 'Gone.' }], tools: [tool] });
    const said = await run('say', 'Hello');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;

    const empty = await run('session', 'rules', sessionId);
    expect(empty.out).toBe('mode default\nno rules\n');

    const set = await run('session', 'set', sessionId, '--deny', 'shell_exec(rm *)', '--allow', 'delete_file', '--ask', 'web_fetch');
    expect(set.code).toBe(0);
    expect(set.out).toContain('rules deny shell_exec(rm *), ask web_fetch, allow delete_file');
    // The same rule again is not repeated; a second one joins the list.
    await run('session', 'set', sessionId, '--deny', 'shell_exec(rm *)', '--deny', 'shell_exec(sudo *)');
    const listed = await run('session', 'rules', sessionId);
    expect(listed.out).toBe(['mode default', 'deny  session shell_exec(rm *)', 'deny  session shell_exec(sudo *)', 'ask   session web_fetch', 'allow session delete_file', ''].join('\n'));
    const json = JSON.parse((await run('session', 'rules', sessionId, '--json')).out) as { mode: string; rules: unknown[] };
    expect(json.mode).toBe('default');
    expect(json.rules).toHaveLength(4);
    expect(json.rules[0]).toEqual({ list: 'deny', origin: 'session', tool: 'shell_exec', match: 'rm *' });

    const malformed = await run('session', 'set', sessionId, '--deny', 'shell_exec(');
    expect(malformed.code).not.toBe(0);
    expect(malformed.err).toContain('must be written Tool or Tool(match)');
    const emptyMatch = await run('session', 'set', sessionId, '--allow', 'web_fetch()');
    expect(emptyMatch.code).not.toBe(0);
    expect(emptyMatch.err).toContain('empty match');

    // The session's allow rule: the destructive tool runs under default without a stop.
    const ran = await run('say', '-s', sessionId, 'Delete a');
    expect(ran.out).toContain('[completed] delete_file');
    expect(ran.out).toContain('Gone.');
    expect(executions()).toBe(1);
  });

  it('lists the configuration\'s rules with their origin, after the session\'s', async () => {
    const store = createMemoryStore();
    const { run } = shell({
      script: [{ text: 'Hi.' }],
      store,
      open: (globals) => {
        const rules = { deny: [{ tool: 'shell_exec', match: 'rm *' }], allow: [{ tool: 'web_fetch' }] };
        const { chat } = testChat({ script: [{ text: 'Hi.' }], store, config: { rules }, workspace: String(globals['workspace'] ?? '/work') });
        return { chat, config: testConfig({ providers: [], rules }), workspace: '/work', home: '/nowhere', remember: async () => [] };
      },
    });
    const said = await run('say', 'Hello');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;
    await run('session', 'set', sessionId, '--deny', 'delete_file', '-p', 'acceptEdits');
    const listed = await run('session', 'rules', sessionId);
    expect(listed.out).toBe(['mode acceptEdits', 'deny  session delete_file', 'deny  config  shell_exec(rm *)', 'allow config  web_fetch', ''].join('\n'));
  });

  it('remembers -m on a new session and session set in the configuration, and a fresh papo starts the next session from them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'papo-remember-'));
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(root, 'config') };
    const file = join(root, 'config', 'papo', 'config.json');
    const store = createMemoryStore();
    // What `openPapo` does, over the scripted provider: one `config` read from the temp home, held by the chat and written back by `remember`.
    const fresh = (script: FakeStep[]) => shell({
      script,
      store,
      open: () => {
        const loaded = loadConfig({ cwd: root, env });
        const config = testConfig({ ...(loaded.model !== undefined ? { model: loaded.model } : { model: undefined }), permissions: loaded.permissions, reasoning: loaded.reasoning });
        const chat = createChat({ store, config, providers: [fakeProvider(script)], workspace: root, home: '/nowhere', warn: () => {} });
        return { chat, config, workspace: root, home: '/nowhere', remember: rememberInto({ config, cwd: root, env }) };
      },
    });
    try {
      const first = fresh([{ text: 'Hello back.' }]);
      const said = await first.run('say', '-m', 'fake/other', 'Hello');
      expect(said.code).toBe(0);
      expect(said.out).toContain(`remembered in ${file}\n`);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'fake/other' });

      const second = fresh([{ text: 'Again.' }, { text: 'And back.' }]);
      const again = await second.run('say', 'Once more', '--json');
      expect(again.code).toBe(0);
      const { sessionId } = JSON.parse(again.out) as { sessionId: string };
      const shown = await second.run('session', 'show', sessionId);
      expect(shown.out).toContain('model fake/other · permissions default · reasoning off');
      const set = await second.run('session', 'set', sessionId, '-p', 'acceptEdits', '-a', 'on');
      expect(set.code).toBe(0);
      expect(set.out).toBe(`model fake/other · permissions acceptEdits · reasoning off · autocompact on\nremembered in ${file}\n`);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'fake/other', permissions: 'acceptEdits' });

      // On a session that exists, -m stays the session's: nothing is remembered.
      const steered = await second.run('say', '-s', sessionId, '-m', 'fake/scripted', 'And again');
      expect(steered.out).not.toContain('remembered in');
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'fake/other', permissions: 'acceptEdits' });

      const third = fresh([{ text: 'Third.' }]);
      const thirdSaid = await third.run('say', 'Third time', '--json');
      const shownThird = await third.run('session', 'show', (JSON.parse(thirdSaid.out) as { sessionId: string }).sessionId);
      expect(shownThird.out).toContain('model fake/other · permissions acceptEdits · reasoning off');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts, shows the model\'s view with the tokens before and after, and --all shows everything; a limit stop is printed', async () => {
    const { run } = shell({ script: [{ text: 'Hello back.' }, { text: 'We said hello.' }, { text: 'Still here.' }] });
    const said = await run('say', 'Hello there');
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;
    const compacted = await run('compact', sessionId);
    expect(compacted.code).toBe(0);
    expect(compacted.out).toMatch(/\[Context compacted: \d+ tokens to \d+\.\]\nSummary of the conversation so far:\n\nWe said hello\./);

    const view = await run('session', 'show', sessionId);
    expect(view.out).toContain('> (context compacted)');
    expect(view.out).toMatch(/Context compacted: \d+ tokens to \d+\./);
    expect(view.out).toContain('> Hello there');
    expect(view.out).not.toContain('Summarize the conversation so far.');
    const all = await run('session', 'show', sessionId, '--all');
    expect(all.out).toContain('> Summarize the conversation so far.');
    expect(all.out).not.toContain('(context compacted)');
    expect(all.out.indexOf('> Hello there')).toBeLessThan(all.out.indexOf('> Summarize'));
  });

  it('lists the providers and the models of each, and a provider that is down neither hides the others nor loses its own error', async () => {
    const down: ModelProvider = {
      id: 'down',
      listModels: async () => { throw new Error('connect ECONNREFUSED 10.255.10.10:1235'); },
      model: () => { throw new Error('never asked'); },
    };
    const config = testConfig({ model: undefined, providers: [{ id: 'fake', baseUrl: 'http://fake.invalid/v1', apiKey: 'k' }, { id: 'local', baseUrl: 'http://10.255.10.10:1235/v1' }] });
    const { run } = shell({
      script: [],
      open: () => {
        const { chat } = testChat({ script: [], config, providers: [down] });
        return { chat, config, workspace: '/work', home: '/nowhere', remember: async () => [] };
      },
    });
    const providers = await run('providers', '--json');
    expect(JSON.parse(providers.out)).toEqual([
      { id: 'fake', baseUrl: 'http://fake.invalid/v1', key: true, default: true },
      { id: 'local', baseUrl: 'http://10.255.10.10:1235/v1', key: false, default: false },
    ]);
    const table = await run('providers');
    expect(table.out).toContain('first listed');
    expect(table.out).not.toContain('k ');

    const all = await run('models', '--json');
    expect(all.code).toBe(0);
    expect((JSON.parse(all.out) as { ref: string }[]).map((row) => row.ref)).toEqual(['fake/scripted', 'fake/other']);

    const one = await run('models', 'fake');
    expect(one.code).toBe(0);
    expect(one.out).toContain('fake/other');

    const failed = await run('models', 'local');
    expect(failed.code).not.toBe(0);
    expect(failed.err).toContain('ECONNREFUSED');

    const unknown = await run('models', 'nope');
    expect(unknown.code).not.toBe(0);
    expect(unknown.err).toContain('provider "nope" is not configured; configured: fake, local');
  });

  it('opens the screen for a bare invocation and for chat, never for a command', () => {
    const { program } = shell({ script: [] });
    expect(argvFor(program, [])).toEqual(['chat']);
    expect(argvFor(program, ['--workspace', 'say'])).toEqual(['chat', '--workspace', 'say']);
    expect(argvFor(program, ['--home', 'x', '--json'])).toEqual(['chat', '--home', 'x', '--json']);
    expect(argvFor(program, ['say', 'hi'])).toEqual(['say', 'hi']);
    expect(argvFor(program, ['--help'])).toEqual(['--help']);
    expect(argvFor(program, ['--version'])).toEqual(['--version']);
  });

  it('refuses the screen where there is none to open', async () => {
    const { run } = shell({ script: [] });
    const result = await run('chat');
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('not available');
  });
});
