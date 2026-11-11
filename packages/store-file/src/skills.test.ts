import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileSkillSource, parseFrontmatter } from './skills.js';

let root: string;
let workspace: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cofold-skills-'));
  workspace = join(root, 'proj');
  const write = async (dir: string, file: string, text: string) => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, file), text, 'utf8'); };
  await write(join(root, 'skills', 'deploy'), 'SKILL.md', '---\nname: deploy\ndescription: "Ship a release"\n---\n\nRun the deploy checklist.\nSee references/steps.md.\n');
  await write(join(root, 'skills', 'deploy', 'references'), 'steps.md', '1. build\n2. tag\n');
  await write(join(root, 'skills', 'no-frontmatter'), 'SKILL.md', 'Just a body.\n');
  await write(join(root, 'skills', 'bad name!'), 'SKILL.md', '---\ndescription: unreachable\n---\nx\n');
  await write(join(root, 'skills', 'empty-folder'), 'notes.txt', 'no SKILL.md here\n');
  await write(join(workspace, '.agents', 'skills', 'deploy'), 'SKILL.md', '---\nname: deploy\ndescription: Project deploy\n---\nProject-specific deploy.\n');
  await write(join(workspace, '.agents', 'skills', 'review'), 'SKILL.md', "---\nname: review\ndescription: 'Review a PR'\nextra: ignored: colon\n---\nReview it.\n");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('fileSkillSource', () => {
  it('lists global skills, with workspace skills first and shadowing global ones', async () => {
    const source = fileSkillSource({ root });
    const global = await source.list({});
    expect(global.map((s) => [s.name, s.description])).toEqual([['deploy', 'Ship a release'], ['no-frontmatter', '']]);
    expect(global[0]!.ref).toBe(join(root, 'skills', 'deploy'));

    const withWorkspace = await source.list({ workspace });
    expect(withWorkspace.map((s) => [s.name, s.description])).toEqual([['deploy', 'Project deploy'], ['review', 'Review a PR'], ['no-frontmatter', '']]);
    expect(withWorkspace[0]!.ref).toBe(join(workspace, '.agents', 'skills', 'deploy'));
  });

  it('reads no project folder with project false, and asks a function each listing', async () => {
    expect((await fileSkillSource({ root, project: false }).list({ workspace })).map((s) => s.name)).toEqual(['deploy', 'no-frontmatter']);
    let trusted = false;
    const gated = fileSkillSource({ root, project: () => trusted });
    expect((await gated.list({ workspace })).map((s) => s.name)).not.toContain('review');
    trusted = true;
    expect((await gated.list({ workspace })).map((s) => s.name)).toContain('review');
  });

  it('walks .agents/skills up to the folder that holds .git, nearest first', async () => {
    const repo = join(root, 'repo');
    const pkg = join(repo, 'packages', 'pkg');
    const write = async (dir: string, text: string) => { await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'SKILL.md'), text, 'utf8'); };
    await mkdir(join(repo, '.git'), { recursive: true });
    await write(join(repo, '.agents', 'skills', 'lint'), '---\ndescription: Repo lint\n---\nx\n');
    await write(join(pkg, '.agents', 'skills', 'lint'), '---\ndescription: Package lint\n---\nx\n');
    await write(join(root, '.agents', 'skills', 'outside'), '---\ndescription: Above the repo\n---\nx\n');
    const walked = await fileSkillSource({ root, walk: true }).list({ workspace: pkg });
    expect(walked.find((s) => s.name === 'lint')?.description).toBe('Package lint');
    expect(walked.map((s) => s.name)).not.toContain('outside');
    // Without walk, the workspace folder only, as before.
    expect((await fileSkillSource({ root }).list({ workspace: join(repo, 'packages') })).map((s) => s.name)).not.toContain('lint');
  });

  it('reads the body without frontmatter and files beside it; refuses escapes', async () => {
    const source = fileSkillSource({ root });
    const [deploy] = await source.list({});
    expect(await source.read({ ref: deploy!.ref })).toBe('Run the deploy checklist.\nSee references/steps.md.\n');
    expect(await source.read({ ref: deploy!.ref, path: 'references/steps.md' })).toBe('1. build\n2. tag\n');
    await expect(source.read({ ref: deploy!.ref, path: '../no-frontmatter/SKILL.md' })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(source.read({ ref: deploy!.ref, path: join(root, 'skills', 'no-frontmatter', 'SKILL.md') })).rejects.toMatchObject({ code: 'invalid_options' });
    await expect(source.read({ ref: deploy!.ref, path: 'references/missing.md' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(source.read({ ref: join(root, 'skills', 'nope') })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('parseFrontmatter', () => {
  it('handles key: value lines between fences and nothing else', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: "b c"\n---\nbody\n')).toEqual({ meta: { name: 'a', description: 'b c' }, body: 'body\n' });
    expect(parseFrontmatter('---\r\nname: a\r\n---\r\n\r\nbody')).toEqual({ meta: { name: 'a' }, body: 'body' });
    expect(parseFrontmatter('no fences\n')).toEqual({ meta: {}, body: 'no fences\n' });
    expect(parseFrontmatter('---\nname: a\nunterminated')).toEqual({ meta: {}, body: '---\nname: a\nunterminated' });
  });
});
