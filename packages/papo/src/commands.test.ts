import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Io } from '@facio/commands';
import { exitCodeFor } from '@facio/commands';
import type { Store } from '@facio/agents';
import { createMemoryStore } from '@facio/agents';
import type { FakeStep } from '@facio/agents/testing';
import { argvFor, createProgram } from './program.js';
import { deleteFileTool, testChat, testConfig } from './testing.js';

interface Ran { code: number; out: string; err: string }

/** A program over the memory store and a scripted model, with its output captured. */
function shell(args: { script: FakeStep[]; store?: Store; tools?: ReturnType<typeof deleteFileTool>['tool'][] }) {
  const store = args.store ?? createMemoryStore();
  let out = '';
  let err = '';
  const io: Io = { out: (text) => { out += text; }, err: (text) => { err += text; } };
  const program = createProgram({
    io,
    open: (globals) => {
      const { chat } = testChat({ script: args.script, store, ...(args.tools !== undefined ? { tools: args.tools } : {}), workspace: String(globals['workspace'] ?? '/work') });
      return { chat, config: testConfig({ providers: [] }), workspace: '/work', home: '/nowhere' };
    },
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
    const said = await run('say', '-p', 'auto', '-t', 'high', 'Delete a');
    expect(said.code).toBe(0);
    expect(said.out).toContain('Gone.');
    expect(executions()).toBe(1);
    const sessionId = /session (\S+)\n$/.exec(said.out)?.[1] as string;

    const shown = await run('session', 'show', sessionId);
    expect(shown.out).toContain('model fake/scripted · permissions auto · reasoning high');

    const set = await run('session', 'set', sessionId, '-m', 'fake/other', '-t', 'off', '-a', 'on');
    expect(set.code).toBe(0);
    expect(set.out).toBe('model fake/other · permissions auto · reasoning off · autocompact on\n');
    const nothing = await run('session', 'set', sessionId);
    expect(nothing.code).not.toBe(0);
    expect(nothing.err).toContain('nothing to set');
    const wrong = await run('say', '-s', sessionId, '-p', 'sometimes', 'x');
    expect(wrong.code).not.toBe(0);
    expect(wrong.err).toContain('permissions must be one of');
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
