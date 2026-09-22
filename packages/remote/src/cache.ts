import type { CacheOptions } from "./types/cache.js";
import type { ProgramManifest } from "./types/manifest.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UnavailableError } from "@cofold/commands";
import { parseManifest } from "./manifest.js";

/**
 * The manifest on disk, and why it has to be.
 *
 * A remote surface that only exists after a round trip makes `--help` slow and
 * tab completion useless, and makes the whole binary stop working on a train.
 * So the manifest is cached, the cache is used when the network is not there,
 * and a stale answer is preferred to no answer - with a line on stderr, because
 * silently serving yesterday's surface is its own kind of wrong.
 */

interface CacheEntry {
  fetchedAt: number;
  url: string;
  manifest: ProgramManifest;
}

function fileFor(directory: string, url: string): string {
  return join(directory, `${createHash("sha256").update(url).digest("hex").slice(0, 16)}.json`);
}

async function readCache(path: string): Promise<CacheEntry | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CacheEntry;
  } catch {
    return null;
  }
}

export async function loadManifest(url: string, options: CacheOptions): Promise<ProgramManifest> {
  const path = fileFor(options.directory, url);
  const cached = await readCache(path);
  const ttl = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const fresh = cached !== null && Date.now() - cached.fetchedAt < ttl;

  if (fresh && options.refresh !== true) return parseManifest(cached.manifest);

  try {
    const call = options.fetch ?? globalThis.fetch;
    const response = await call(url, { headers: { accept: "application/json", ...options.headers } });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const manifest = parseManifest(await response.json());
    await mkdir(options.directory, { recursive: true });
    await writeFile(path, JSON.stringify({ fetchedAt: Date.now(), url, manifest } satisfies CacheEntry, null, 2));
    return manifest;
  } catch (error: unknown) {
    if (cached !== null) {
      const age = Math.round((Date.now() - cached.fetchedAt) / 60000);
      options.warn?.(`Using the cached command surface from ${age} minutes ago: ${url} is not answering`);
      return parseManifest(cached.manifest);
    }
    throw new UnavailableError(`Cannot read the command surface from ${url}`, { cause: error });
  }
}
