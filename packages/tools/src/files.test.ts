import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapabilityArgs, Tool, ToolContext } from '@doopx/agents';
import { createMemoryStore } from '@doopx/agents';
import { files } from './files.js';
import { displayPath, resolveWithin } from './paths.js';

let workspace: string;
let tools: Map<string, Tool<any, any>>;

const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
const ctx: ToolContext = { agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal: new AbortController().signal, kv, resources: {} };
const argsFor = (workspace: string): CapabilityArgs => ({ agentId: 't', sessionId: 's', runId: 'r', workspace, kv, signal: ctx.signal });
const call = (name: string, input: unknown) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return Promise.resolve(tool.execute(input, ctx));
};

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'doopx-tools-'));
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

describe('resolveWithin', () => {
  it('resolves relative paths against the workspace and says when one leaves it', () => {
    const root = resolve(sep, 'ws');
    expect(resolveWithin(root, 'src/a.ts')).toEqual({ absolute: join(root, 'src', 'a.ts'), inside: true });
    expect(resolveWithin(root, '.')).toEqual({ absolute: root, inside: true });
    expect(resolveWithin(root, '../other')).toEqual({ absolute: resolve(sep, 'other'), inside: false });
    expect(resolveWithin(root, '..')).toEqual({ absolute: resolve(sep), inside: false });
    expect(resolveWithin(root, join(root, '..sibling'))).toEqual({ absolute: join(root, '..sibling'), inside: true });
    expect(resolveWithin(root, resolve(sep, 'ws2', 'x')).inside).toBe(false);
    expect(displayPath(root, join(root, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(displayPath(root, resolve(sep, 'other')).replaceAll('\\', '/')).toBe(resolve(sep, 'other').replaceAll('\\', '/'));
  });
});
