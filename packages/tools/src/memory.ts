import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Capability, Tool } from '@facio/agents';
import { createTool } from '@facio/agents';
import type { MemoryOptions, MemoryReadInput, MemoryWriteInput } from './types/memory.js';
import { displayPath, resolveWithin } from './paths.js';

const INDEX = 'MEMORY.md';
const DEFAULT_INDEX_LINES = 200;

const RULES = [
  'You have a memory: files that persist across sessions, read with memory_read and written with memory_write. MEMORY.md is the index; the lines below are its beginning.',
  'Write what will matter next session: decisions, preferences, facts about this project. One file per topic, indexed from MEMORY.md with one line each; update a file rather than adding a second on the same topic.',
  'Do not write what the repository already records, and do not write what only matters to this conversation.',
].join('\n');

/**
 * The memory capability (decision 8): `memory_read`, `memory_write`, and the head of `MEMORY.md` in the
 * instructions every run. Files under `dir`, readable and editable by hand.
 */
export function memory(options: MemoryOptions): Capability {
  const dir = resolveWithin(options.dir, '.').absolute;
  const indexLines = options.indexLines ?? DEFAULT_INDEX_LINES;
  return {
    id: 'memory',
    async instructions() {
      const index = await read(join(dir, INDEX));
      if (index === undefined || index.trim() === '') return `${RULES}\n\n${INDEX} is empty.`;
      const lines = index.trimEnd().split('\n');
      const shown = lines.slice(0, indexLines).join('\n').trimEnd();
      const more = lines.length > indexLines ? `\n[${lines.length - indexLines} more lines; memory_read() has them all]` : '';
      return `${RULES}\n\n${shown}${more}`;
    },
    tools: () => memoryTools(dir),
  };
}

function memoryTools(dir: string): Tool<any, any>[] {
  const inside = (path: string) => {
    const resolved = resolveWithin(dir, path);
    if (!resolved.inside) throw new Error(`${path} is outside the memory folder`);
    return resolved.absolute;
  };
  return [
    createTool<MemoryReadInput>({
      name: 'memory_read',
      description: `Read a memory file; without a path, ${INDEX}, the index.`,
      input: {
        type: 'object',
        properties: { path: { type: 'string', description: `Relative to the memory folder; default ${INDEX}` } },
        additionalProperties: false,
      },
      effects: { reads: true },
      execute: async (input) => {
        const path = input.path ?? INDEX;
        const text = await read(inside(path));
        if (text === undefined) return path === INDEX ? 'memory is empty' : `no memory file ${displayPath(dir, inside(path))}`;
        return text;
      },
    }),
    createTool<MemoryWriteInput>({
      name: 'memory_write',
      description: `Write a memory file, whole; folders are made. Keep ${INDEX} pointing at every file.`,
      input: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative to the memory folder' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      effects: { writes: true },
      execute: async (input) => {
        const absolute = inside(input.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, input.content, 'utf8');
        return `wrote ${displayPath(dir, absolute)} (${Buffer.byteLength(input.content)} bytes)`;
      },
    }),
  ];
}

async function read(absolute: string): Promise<string | undefined> {
  return readFile(absolute, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  });
}
