import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importsOf, readContextFiles } from './context.js';

let root: string;
const write = async (path: string, text: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};
/** Only what is under this test's folder: the folders above it belong to the machine. */
const ours = async (workspace: string, common?: string[]) =>
  (await readContextFiles({ workspace, ...(common !== undefined ? { common } : {}) })).filter((file) => file.path.startsWith(root));

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cofold-context-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('readContextFiles', () => {
  it('reads the common files, then each folder from the top down to the workspace', async () => {
    await write(join(root, 'common', 'AGENTS.md'), 'Common.\n');
    await write(join(root, 'AGENTS.md'), 'Top.\n');
    await write(join(root, 'a', 'b', 'AGENTS.md'), 'Workspace.\n');
    const files = await ours(join(root, 'a', 'b'), [join(root, 'common', 'AGENTS.md'), join(root, 'missing', 'AGENTS.md')]);
    expect(files.map((file) => file.text)).toEqual(['Common.', 'Top.', 'Workspace.']);
  });

  it('gives a folder CLAUDE.md only where it has no AGENTS.md, and skips an empty file', async () => {
    await write(join(root, 'CLAUDE.md'), 'Claude top.\n');
    await write(join(root, 'a', 'AGENTS.md'), 'Agents.\n');
    await write(join(root, 'a', 'CLAUDE.md'), 'Not read.\n');
    await write(join(root, 'a', 'b', 'AGENTS.md'), '  \n');
    await write(join(root, 'a', 'b', 'CLAUDE.md'), 'Claude in b.\n');
    const files = await ours(join(root, 'a', 'b'));
    expect(files.map((file) => file.text)).toEqual(['Claude top.', 'Agents.', 'Claude in b.']);
  });

  it('reads a path once when a common file is also a folder file', async () => {
    await write(join(root, 'AGENTS.md'), 'Once.\n');
    const files = await ours(root, [join(root, 'AGENTS.md')]);
    expect(files.map((file) => file.text)).toEqual(['Once.']);
  });

  it('appends imports relative to the importing file, each once, and not from code', async () => {
    await write(join(root, 'docs', 'style.md'), 'Style rules. See @api.md.\n');
    await write(join(root, 'docs', 'api.md'), 'API rules.\n');
    await write(join(root, 'docs', 'skip.md'), 'Never.\n');
    await write(join(root, 'AGENTS.md'), [
      'Read @docs/style.md and again @docs/style.md',
      '`@docs/skip.md` is code.',
      '```',
      '@docs/skip.md',
      '```',
      'Mail me@example.com, not a file: @nobody',
    ].join('\n'));
    const [file] = await ours(root);
    expect(file!.text.split('\n\n').slice(1)).toEqual(['Style rules. See @api.md.', 'API rules.']);
  });

  it('stops at four levels and at a cycle', async () => {
    await write(join(root, 'AGENTS.md'), '@1.md');
    for (let level = 1; level <= 5; level += 1) await write(join(root, `${level}.md`), `Level ${level}. @${level + 1}.md`);
    await write(join(root, 'cycle', 'AGENTS.md'), 'Start @x.md');
    await write(join(root, 'cycle', 'x.md'), 'X @y.md');
    await write(join(root, 'cycle', 'y.md'), 'Y @x.md @AGENTS.md');
    const [top] = await ours(root);
    expect(top!.text).toContain('Level 4.');
    expect(top!.text).not.toContain('Level 5.');
    const files = await ours(join(root, 'cycle'));
    expect(files[1]!.text.split('\n\n')).toEqual(['Start @x.md', 'X @y.md', 'Y @x.md @AGENTS.md']);
  });

  it('reads an escaped space in a path', () => {
    expect(importsOf('See @Design\\ Docs/api.md now')).toEqual(['Design Docs/api.md']);
  });
});
