import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readJson, writeAtomic } from './jsonl.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'cofold-jsonl-')); });
afterEach(() => rm(dir, { recursive: true, force: true }));

/**
 * A reader projecting a run while the loop updates it: on Windows the rename over a file a reader
 * has open fails with EPERM, and a store that surfaced that would fail a turn because a screen looked
 * at it. Every write must land, and every read must see a whole document or none.
 */
it('lets writes land while readers hold the file open', async () => {
  const file = join(dir, 'run.json');
  await writeAtomic(file, { n: 0 });
  const writes = (async () => { for (let n = 1; n <= 150; n++) await writeAtomic(file, { n }); })();
  const reads = (async () => {
    for (let i = 0; i < 400; i++) {
      const seen = await readJson<{ n: number }>(file);
      expect(seen === undefined || Number.isInteger(seen.n)).toBe(true);
    }
  })();
  await Promise.all([writes, reads]);
  expect(await readJson(file)).toEqual({ n: 150 });
});
