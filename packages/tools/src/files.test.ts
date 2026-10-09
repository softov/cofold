import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CapabilityArgs, Tool, ToolContext } from '@cofold/agents';
import { createMemoryStore } from '@cofold/agents';
import { files } from './files.js';
import { displayPath, resolveWithin } from './paths.js';

/** A step run once, just before the next `open` from `node:fs/promises`: a stand-in for another process. */
const opening = vi.hoisted(() => ({ before: undefined as (() => Promise<void>) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open: typeof actual.open = async (...args) => {
    const before = opening.before;
    opening.before = undefined;
    await before?.();
    return actual.open(...args);
  };
  return { ...actual, open };
});

let workspace: string;
let tools: Map<string, Tool<any, any>>;

const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
const ctx: ToolContext = { agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal: new AbortController().signal, kv, resources: {} };
const argsFor = (workspace: string, sessionId = 's'): CapabilityArgs => ({ agentId: 't', sessionId, runId: 'r', workspace, kv, signal: ctx.signal });
const call = (name: string, input: unknown) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return Promise.resolve(tool.execute(input, ctx));
};

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'cofold-tools-'));
  await mkdir(join(workspace, 'src', 'deep'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', 'dep'), { recursive: true });
  await writeFile(join(workspace, 'src', 'a.ts'), 'const a = 1;\nexport const b = a + 1;\n// TODO later\n');
  await writeFile(join(workspace, 'src', 'deep', 'c.ts'), 'export const c = 3; // todo\n');
  await writeFile(join(workspace, 'README.md'), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
  await writeFile(join(workspace, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  await writeFile(join(workspace, 'node_modules', 'dep', 'index.js'), 'const a = 0;\n');
  const capability = files({ maxLines: 5, maxMatches: 3 });
  const list = await capability.tools!(argsFor(workspace));
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterAll(() => rm(workspace, { recursive: true, force: true }));

describe('files()', () => {
  it('contributes the five tools, their effects, and a section naming the workspace', async () => {
    expect([...tools.keys()]).toEqual(['read_file', 'write_file', 'edit_file', 'list_files', 'search_files']);
    expect(tools.get('read_file')!.effects).toEqual({ reads: true });
    expect(tools.get('write_file')!.effects).toEqual({ writes: true, destructive: true });
    expect(tools.get('edit_file')!.effects).toEqual({ writes: true, destructive: true });
    expect(await files().instructions!(argsFor(workspace))).toContain(workspace);
  });

  it('names its subjects for permission rules: the resolved path (relative inside the workspace, absolute outside), or the pattern for the two that take none', () => {
    // Decision CLI-04.6: a rule's glob sees where the tool will go, so `..` and `./` cannot slip past it.
    expect(tools.get('read_file')!.subject!({ path: 'src/a.ts', offset: 2 })).toBe('src/a.ts');
    expect(tools.get('read_file')!.subject!({ path: join(workspace, 'src', 'a.ts') })).toBe('src/a.ts');
    expect(tools.get('write_file')!.subject!({ path: './out.txt', content: 'x' })).toBe('out.txt');
    expect(tools.get('write_file')!.subject!({ path: 'src/../out.txt', content: 'x' })).toBe('out.txt');
    expect(tools.get('edit_file')!.subject!({ path: 'src/a.ts', old: 'a', new: 'b' })).toBe('src/a.ts');
    expect(tools.get('edit_file')!.subject!({ path: '../outside/x.ts', old: 'a', new: 'b' })).toBe(resolve(workspace, '..', 'outside', 'x.ts').split(sep).join('/'));
    expect(tools.get('list_files')!.subject!({ pattern: 'src/**/*.ts', cwd: '.' })).toBe('src/**/*.ts');
    expect(tools.get('search_files')!.subject!({ pattern: 'todo', path: 'src' })).toBe('todo');
  });

  it('declares the file it writes, absolutely, for the two that write one (tools/02 task 02)', () => {
    expect(tools.get('write_file')!.writes!({ path: 'src/a.ts', content: '' })).toBe(resolve(workspace, 'src/a.ts'));
    expect(tools.get('write_file')!.writes!({ path: 'src/../out.txt', content: '' })).toBe(resolve(workspace, 'out.txt'));
    expect(tools.get('edit_file')!.writes!({ path: '../outside/x.ts', old: 'a', new: 'b' })).toBe(resolve(workspace, '..', 'outside', 'x.ts'));
    // The ones that write no single named file say nothing, so their effects decide.
    for (const name of ['read_file', 'list_files', 'search_files']) expect(tools.get(name)!.writes).toBeUndefined();
  });

  it('read_file numbers lines, pages with offset and limit, and refuses binary', async () => {
    expect(await call('read_file', { path: 'src/a.ts' })).toBe('1│const a = 1;\n2│export const b = a + 1;\n3│// TODO later');
    expect(await call('read_file', { path: 'README.md' })).toBe('1│line 1\n2│line 2\n3│line 3\n4│line 4\n5│line 5\n[7 more lines; read from offset 6]');
    expect(await call('read_file', { path: 'README.md', offset: 9, limit: 2 })).toBe(' 9│line 9\n10│line 10\n[2 more lines; read from offset 11]');
    expect(await call('read_file', { path: join(workspace, 'README.md'), offset: 11 })).toBe('11│line 11\n12│line 12');
    await expect(call('read_file', { path: 'image.bin' })).rejects.toThrow('image.bin is binary');
    await expect(call('read_file', { path: 'missing.txt' })).rejects.toThrow('no file at missing.txt');
    await expect(call('read_file', { path: 'src' })).rejects.toThrow('src is a folder; use list_files');
    await expect(call('read_file', { path: 'README.md', offset: 13 })).rejects.toThrow('README.md has 12 lines; offset 13 is past the end');
  });

  it('write_file creates parents and says whether it replaced', async () => {
    expect(await call('write_file', { path: 'out/new/file.txt', content: 'hello' })).toBe('created out/new/file.txt (5 bytes)');
    expect(await readFile(join(workspace, 'out', 'new', 'file.txt'), 'utf8')).toBe('hello');
    expect(await call('write_file', { path: 'out/new/file.txt', content: 'bye' })).toBe('replaced out/new/file.txt (3 bytes)');
  });

  it('edit_file replaces exactly one occurrence, every one with all, and refuses zero or several', async () => {
    await writeFile(join(workspace, 'edit.txt'), 'one two one\nthree\n');
    await call('read_file', { path: 'edit.txt' });
    await expect(call('edit_file', { path: 'edit.txt', old: 'four', new: 'x' })).rejects.toThrow('old text not found in edit.txt');
    await expect(call('edit_file', { path: 'edit.txt', old: 'one', new: 'x' })).rejects.toThrow('old text occurs 2 times in edit.txt; add context to make it unique, or pass all: true');
    expect(await call('edit_file', { path: 'edit.txt', old: 'three', new: '$& $1' })).toBe('edited edit.txt: 1 replacement');
    expect(await readFile(join(workspace, 'edit.txt'), 'utf8')).toBe('one two one\n$& $1\n');
    expect(await call('edit_file', { path: 'edit.txt', old: 'one', new: '1', all: true })).toBe('edited edit.txt: 2 replacements');
    expect(await readFile(join(workspace, 'edit.txt'), 'utf8')).toBe('1 two 1\n$& $1\n');
  });

  it('list_files globs from the workspace or a cwd, marks folders, and skips node_modules unless named', async () => {
    expect(await call('list_files', { pattern: 'src/**/*.ts' })).toBe('src/a.ts\nsrc/deep/c.ts');
    expect(await call('list_files', { pattern: '*', cwd: 'src' })).toBe('a.ts\ndeep/');
    expect(await call('list_files', { pattern: '**/*.js' })).toBe('no files match **/*.js under .');
    expect(await call('list_files', { pattern: 'node_modules/**/*.js' })).toBe('node_modules/dep/index.js');
  });

  it('search_files returns file:line:text rows, honours glob, ignoreCase and limit, and skips binary', async () => {
    expect(await call('search_files', { pattern: 'const [ab]', path: 'src' })).toBe('src/a.ts:1:const a = 1;\nsrc/a.ts:2:export const b = a + 1;');
    expect(await call('search_files', { pattern: 'todo', ignoreCase: true, glob: '**/*.ts' })).toBe('src/a.ts:3:// TODO later\nsrc/deep/c.ts:1:export const c = 3; // todo');
    expect(await call('search_files', { pattern: 'todo', glob: '**/*.ts' })).toBe('src/deep/c.ts:1:export const c = 3; // todo');
    expect(await call('search_files', { pattern: '.', path: 'README.md', limit: 2 })).toBe('README.md:1:line 1\nREADME.md:2:line 2\n[2 rows; narrow with path or glob]');
    expect(await call('search_files', { pattern: 'line', path: 'README.md' })).toMatch(/\[3 rows; narrow with path or glob\]$/);
    expect(await call('search_files', { pattern: 'zzz' })).toBe('no matches for /zzz/ under .');
    expect(await call('search_files', { pattern: 'const a = 0' })).toBe('no matches for /const a = 0/ under .');
    await expect(call('search_files', { pattern: '(' })).rejects.toThrow('invalid regular expression /(/');
  });
});

describe('write_file and edit_file write the file they checked (plugin/22 task 02)', () => {
  let outside: string;
  beforeAll(async () => { outside = await mkdtemp(join(tmpdir(), 'cofold-outside-')); });
  afterAll(() => rm(outside, { recursive: true, force: true }));
  afterEach(() => { opening.before = undefined; });

  /** Just before the tool opens the file, puts a link to `target` at `name` in the workspace. */
  const linkOnOpen = (name: string, target: string) => {
    opening.before = async () => {
      await rm(join(workspace, name), { force: true });
      await symlink(target, join(workspace, name));
    };
  };
  const missing = (path: string) => access(path).then(() => false, () => true);

  it('write_file refuses a file swapped for a link out of the workspace between the check and the open', async () => {
    await writeFile(join(outside, 'secret.txt'), 'kept');
    await writeFile(join(workspace, 'swap.txt'), 'inside');
    await call('read_file', { path: 'swap.txt' });
    linkOnOpen('swap.txt', join(outside, 'secret.txt'));
    await expect(call('write_file', { path: 'swap.txt', content: 'x' })).rejects.toThrow('swap.txt changed after it was checked; nothing was written');
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('kept');
  });

  it('edit_file refuses a file swapped for a link out of the workspace between the check and the open', async () => {
    await writeFile(join(outside, 'other.txt'), 'inside too');
    await writeFile(join(workspace, 'swap-edit.txt'), 'inside');
    await call('read_file', { path: 'swap-edit.txt' });
    linkOnOpen('swap-edit.txt', join(outside, 'other.txt'));
    await expect(call('edit_file', { path: 'swap-edit.txt', old: 'inside', new: 'x' })).rejects.toThrow('swap-edit.txt changed after it was checked; nothing was written');
    expect(await readFile(join(outside, 'other.txt'), 'utf8')).toBe('inside too');
  });

  it('write_file refuses a new file whose name became a link between the check and the open', async () => {
    linkOnOpen('planted.txt', join(outside, 'planted.txt'));
    await expect(call('write_file', { path: 'planted.txt', content: 'x' })).rejects.toThrow('planted.txt changed after it was checked; nothing was written');
    expect(await missing(join(outside, 'planted.txt'))).toBe(true);
  });

  it('writes and edits through a link that stays inside the workspace, onto its target', async () => {
    await writeFile(join(workspace, 'target.txt'), 'first');
    await symlink(join(workspace, 'target.txt'), join(workspace, 'alias.txt'));
    await call('read_file', { path: 'alias.txt' });
    expect(await call('write_file', { path: 'alias.txt', content: 'second line' })).toBe('replaced alias.txt (11 bytes)');
    expect(await call('edit_file', { path: 'alias.txt', old: 'second', new: 'third' })).toBe('edited alias.txt: 1 replacement');
    expect(await readFile(join(workspace, 'target.txt'), 'utf8')).toBe('third line');
  });

  it('write_file creates a new file inside, and truncates a longer one it replaces', async () => {
    expect(await call('write_file', { path: 'made/here.txt', content: 'a long first text' })).toBe('created made/here.txt (17 bytes)');
    expect(await call('write_file', { path: 'made/here.txt', content: 'short' })).toBe('replaced made/here.txt (5 bytes)');
    expect(await readFile(join(workspace, 'made', 'here.txt'), 'utf8')).toBe('short');
  });
});

describe('a write to a file changed since the session read it is refused (plugin/22 task 03)', () => {
  /** The file tools one run of `sessionId` gets, from `capability` (a fresh `files()` by default). */
  const runOf = async (sessionId: string, capability = files()) => {
    const list = await capability.tools!(argsFor(workspace, sessionId));
    const byName = new Map(list.map((tool) => [tool.name, tool]));
    return (name: string, input: unknown) => Promise.resolve(byName.get(name)!.execute(input, { ...ctx, sessionId }));
  };
  const notRead = (name: string) => `${name} was not read in this session; read it with read_file first`;
  const changedSinceRead = (name: string) => `${name} changed since it was read; read it again with read_file first`;

  it('lets a session write and edit a file it read', async () => {
    await writeFile(join(workspace, 'fresh-1.txt'), 'one\n');
    const run = await runOf('read-then-write');
    await run('read_file', { path: 'fresh-1.txt' });
    expect(await run('edit_file', { path: 'fresh-1.txt', old: 'one', new: 'two' })).toBe('edited fresh-1.txt: 1 replacement');
    expect(await run('write_file', { path: 'fresh-1.txt', content: 'three' })).toBe('replaced fresh-1.txt (5 bytes)');
    expect(await run('edit_file', { path: 'fresh-1.txt', old: 'three', new: 'four' })).toBe('edited fresh-1.txt: 1 replacement');
    expect(await readFile(join(workspace, 'fresh-1.txt'), 'utf8')).toBe('four');
  });

  it('refuses a write or an edit to an existing file the session never read', async () => {
    await writeFile(join(workspace, 'unread.txt'), 'kept');
    const run = await runOf('never-read');
    await expect(run('write_file', { path: 'unread.txt', content: 'x' })).rejects.toThrow(notRead('unread.txt'));
    await expect(run('edit_file', { path: 'unread.txt', old: 'kept', new: 'x' })).rejects.toThrow(notRead('unread.txt'));
    expect(await readFile(join(workspace, 'unread.txt'), 'utf8')).toBe('kept');
  });

  it('refuses a write or an edit to a file changed from outside since the read, until it is read again', async () => {
    await writeFile(join(workspace, 'moved-on.txt'), 'before');
    const run = await runOf('changed-outside');
    await run('read_file', { path: 'moved-on.txt' });
    await writeFile(join(workspace, 'moved-on.txt'), 'someone else wrote this');
    await expect(run('write_file', { path: 'moved-on.txt', content: 'x' })).rejects.toThrow(changedSinceRead('moved-on.txt'));
    await expect(run('edit_file', { path: 'moved-on.txt', old: 'else', new: 'x' })).rejects.toThrow(changedSinceRead('moved-on.txt'));
    expect(await readFile(join(workspace, 'moved-on.txt'), 'utf8')).toBe('someone else wrote this');
    await run('read_file', { path: 'moved-on.txt' });
    expect(await run('edit_file', { path: 'moved-on.txt', old: 'else', new: 'other' })).toBe('edited moved-on.txt: 1 replacement');
  });

  it('writes a new file without a read, and writes it again after', async () => {
    const run = await runOf('new-file');
    expect(await run('write_file', { path: 'brand-new.txt', content: 'a' })).toBe('created brand-new.txt (1 bytes)');
    expect(await run('write_file', { path: 'brand-new.txt', content: 'bb' })).toBe('replaced brand-new.txt (2 bytes)');
  });

  it('keeps the record across the runs of a session, and not across sessions', async () => {
    await writeFile(join(workspace, 'two-runs.txt'), 'start');
    await (await runOf('across-runs'))('read_file', { path: 'two-runs.txt' });
    await expect((await runOf('another-session'))('write_file', { path: 'two-runs.txt', content: 'x' })).rejects.toThrow(notRead('two-runs.txt'));
    expect(await (await runOf('across-runs'))('write_file', { path: 'two-runs.txt', content: 'next' })).toBe('replaced two-runs.txt (4 bytes)');
  });

  it('forgets what was read when the process restarts, so a write needs a read again', async () => {
    await writeFile(join(workspace, 'restart.txt'), 'start');
    await (await runOf('restarted'))('read_file', { path: 'restart.txt' });
    vi.resetModules();
    const { files: afterRestart } = await import('./files.js');
    const run = await runOf('restarted', afterRestart());
    await expect(run('write_file', { path: 'restart.txt', content: 'x' })).rejects.toThrow(notRead('restart.txt'));
    await run('read_file', { path: 'restart.txt' });
    expect(await run('write_file', { path: 'restart.txt', content: 'x' })).toBe('replaced restart.txt (1 bytes)');
  });
});

describe('files({ requireRead: false }) turns the read-before-write refusal off', () => {
  /** The file tools one run of `sessionId` gets, from `capability` (a fresh `files()` by default). */
  const runOf = async (sessionId: string, capability = files()) => {
    const list = await capability.tools!(argsFor(workspace, sessionId));
    const byName = new Map(list.map((tool) => [tool.name, tool]));
    return (name: string, input: unknown) => Promise.resolve(byName.get(name)!.execute(input, { ...ctx, sessionId }));
  };
  const off = () => files({ requireRead: false });
  const notRead = (name: string) => `${name} was not read in this session; read it with read_file first`;

  it('writes and edits a file the session never read', async () => {
    await writeFile(join(workspace, 'optout-unread.txt'), 'one\n');
    const run = await runOf('optout-unread', off());
    expect(await run('edit_file', { path: 'optout-unread.txt', old: 'one', new: 'two' })).toBe('edited optout-unread.txt: 1 replacement');
    expect(await run('write_file', { path: 'optout-unread.txt', content: 'three' })).toBe('replaced optout-unread.txt (5 bytes)');
    expect(await readFile(join(workspace, 'optout-unread.txt'), 'utf8')).toBe('three');
  });

  it('writes and edits a file that changed from outside since the read', async () => {
    await writeFile(join(workspace, 'optout-moved.txt'), 'before');
    const run = await runOf('optout-moved', off());
    await run('read_file', { path: 'optout-moved.txt' });
    await writeFile(join(workspace, 'optout-moved.txt'), 'someone else wrote this');
    expect(await run('edit_file', { path: 'optout-moved.txt', old: 'else', new: 'other' })).toBe('edited optout-moved.txt: 1 replacement');
    await writeFile(join(workspace, 'optout-moved.txt'), 'written again');
    expect(await run('write_file', { path: 'optout-moved.txt', content: 'x' })).toBe('replaced optout-moved.txt (1 bytes)');
  });

  it('still records what a read saw, so a later run with the rule on can write it', async () => {
    await writeFile(join(workspace, 'optout-record.txt'), 'start');
    await (await runOf('optout-record', off()))('read_file', { path: 'optout-record.txt' });
    expect(await (await runOf('optout-record'))('write_file', { path: 'optout-record.txt', content: 'next' })).toBe('replaced optout-record.txt (4 bytes)');
  });

  it('refuses an unread file and a file the session read without the option, as before', async () => {
    await writeFile(join(workspace, 'optout-default.txt'), 'kept');
    const run = await runOf('optout-default');
    await expect(run('write_file', { path: 'optout-default.txt', content: 'x' })).rejects.toThrow(notRead('optout-default.txt'));
    await expect(run('edit_file', { path: 'optout-default.txt', old: 'kept', new: 'x' })).rejects.toThrow(notRead('optout-default.txt'));
    await run('read_file', { path: 'optout-default.txt' });
    await writeFile(join(workspace, 'optout-default.txt'), 'someone else wrote this');
    await expect(run('write_file', { path: 'optout-default.txt', content: 'x' })).rejects.toThrow('optout-default.txt changed since it was read; read it again with read_file first');
    expect(await readFile(join(workspace, 'optout-default.txt'), 'utf8')).toBe('someone else wrote this');
  });
});

describe('resolveWithin', () => {
  it('resolves relative paths against the workspace and says when one leaves it', () => {
    const root = resolve(sep, 'ws');
    expect(resolveWithin(root, 'src/a.ts')).toMatchObject({ absolute: join(root, 'src', 'a.ts'), inside: true });
    expect(resolveWithin(root, '.')).toMatchObject({ absolute: root, inside: true });
    expect(resolveWithin(root, '../other')).toMatchObject({ absolute: resolve(sep, 'other'), inside: false });
    expect(resolveWithin(root, '..')).toMatchObject({ absolute: resolve(sep), inside: false });
    expect(resolveWithin(root, join(root, '..sibling'))).toMatchObject({ absolute: join(root, '..sibling'), inside: true });
    expect(resolveWithin(root, resolve(sep, 'ws2', 'x')).inside).toBe(false);
    expect(displayPath(root, join(root, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(displayPath(root, resolve(sep, 'other')).replaceAll('\\', '/')).toBe(resolve(sep, 'other').replaceAll('\\', '/'));
  });

  it('judges inside on real paths: a symlink out of the workspace is outside, a workspace reached through one is not', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cofold-within-'));
    try {
      const ws = join(base, 'ws');
      const elsewhere = join(base, 'elsewhere');
      await mkdir(ws);
      await mkdir(elsewhere);
      await symlink(elsewhere, join(ws, 'link'), 'dir');
      await symlink(ws, join(base, 'alias'), 'dir');
      await symlink(join(elsewhere, 'later.txt'), join(ws, 'dangling'));
      expect(resolveWithin(ws, 'link/new.txt')).toMatchObject({ absolute: join(ws, 'link', 'new.txt'), inside: false });
      expect(resolveWithin(ws, 'link').inside).toBe(false);
      expect(resolveWithin(ws, 'link/new.txt').real).toBe(join(realpathSync(elsewhere), 'new.txt'));
      expect(resolveWithin(ws, 'sub/new.txt').real).toBe(join(realpathSync(ws), 'sub', 'new.txt'));
      expect(resolveWithin(ws, 'dangling').inside).toBe(false);
      expect(resolveWithin(ws, 'sub/new.txt')).toMatchObject({ absolute: join(ws, 'sub', 'new.txt'), inside: true });
      expect(resolveWithin(join(base, 'alias'), 'sub/new.txt').inside).toBe(true);
      expect(resolveWithin(ws, join(base, 'alias', 'x')).inside).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
