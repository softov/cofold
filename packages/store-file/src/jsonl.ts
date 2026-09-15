import { appendFile, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One JSON object per line. A torn tail left by a crash mid-append is closed off first so the new line stays intact. */
export async function appendLine(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const prefix = (await endsWithNewline(file)) ? '' : '\n';
  await appendFile(file, `${prefix}${JSON.stringify(value)}\n`, 'utf8');
}

/** Every intact line; a torn line (a crash mid-append) is skipped, everything else is kept. */
export async function readLines<T>(file: string): Promise<T[]> {
  const text = await readText(file);
  if (text === undefined) return [];
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as T); }
    catch { continue; }
  }
  return out;
}

/** True for a missing or empty file too: nothing to close off. */
async function endsWithNewline(file: string): Promise<boolean> {
  let handle;
  try { handle = await open(file, 'r'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw e;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as T; }
  catch { return undefined; }
}

/** tmp + rename, so a reader never sees a half-written file. */
export async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function readText(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
