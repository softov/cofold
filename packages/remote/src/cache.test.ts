/**
 * A command surface that has to work on a train.
 *
 * The promise `loadManifest` makes is not "fetch a manifest" - it is that
 * `--help` and completion keep working when the network does not, and that
 * nobody is served yesterday's surface without being told. Both halves are
 * behaviour a person only notices when it is missing, so both are pinned here.
 */

import type { ProgramManifest } from "./types/manifest.js";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_VERSION } from "./manifest.js";
import { loadManifest } from "./cache.js";

const URL = "http://service.test/cli-manifest";

function manifestOf(summary: string): ProgramManifest {
  return {
    doopx: MANIFEST_VERSION,
    program: { name: "clerver", version: "0.1.0" },
    commands: [{
      id: "pet.list",
      pattern: ["pet", "list"],
      summary,
      http: { method: "GET", path: "/pets" },
    }],
  } as ProgramManifest;
}

/** A fetch that counts its calls and can be told to stop answering. */
function server(manifest: ProgramManifest) {
  const state = { calls: 0, answering: true, status: 200, body: manifest };
  const fetch = (async () => {
    state.calls += 1;
    if (!state.answering) throw new Error("connect ECONNREFUSED");
    return {
      ok: state.status < 400,
      status: state.status,
      json: async () => Promise.resolve(state.body),
    } as Response;
  }) as typeof globalThis.fetch;
  return { state, fetch };
}

let directory: string;
const warnings: string[] = [];
const warn = (message: string): void => { warnings.push(message); };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "doopx-cache-"));
  warnings.length = 0;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the first time", () => {
  it("fetches, and writes what it got where it can find it again", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    const manifest = await loadManifest(URL, { directory, fetch, warn });

    expect(manifest.commands[0]?.summary).toBe("List the pets");
    expect(state.calls).toBe(1);
    expect((await readdir(directory)).length).toBe(1);
  });

  it("refuses a manifest it cannot read, rather than half a surface", async () => {
    const { fetch } = server({
      doopx: MANIFEST_VERSION + 1,
      program: { name: "x", version: "1" },
      commands: [],
    });
    await expect(loadManifest(URL, { directory, fetch, warn })).rejects.toThrow();
  });

  it("says where it could not read a surface from, when there is nothing cached", async () => {
    const { state, fetch } = server(manifestOf("List"));
    state.answering = false;
    await expect(loadManifest(URL, { directory, fetch, warn }))
      .rejects.toThrow(`Cannot read the command surface from ${URL}`);
  });
});

describe("afterwards", () => {
  /*
   * Help and completion run on every keystroke somebody types. A round trip
   * there is the difference between a binary that feels local and one that
   * does not, so a fresh cache is answered from without asking anybody.
   */
  it("answers from the cache without a round trip", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    await loadManifest(URL, { directory, fetch, warn });
    const again = await loadManifest(URL, { directory, fetch, warn });

    expect(again.commands[0]?.summary).toBe("List the pets");
    expect(state.calls).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("goes back once the cache is older than the ttl", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    await loadManifest(URL, { directory, fetch, warn });
    state.body = manifestOf("List every pet");

    const fresh = await loadManifest(URL, { directory, fetch, warn, ttlMs: -1 });
    expect(fresh.commands[0]?.summary).toBe("List every pet");
    expect(state.calls).toBe(2);
  });

  it("goes back when asked to refresh, however fresh the cache is", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    await loadManifest(URL, { directory, fetch, warn });
    await loadManifest(URL, { directory, fetch, warn, refresh: true });
    expect(state.calls).toBe(2);
  });

  /*
   * A stale surface beats no surface, and silence about it beats neither. The
   * line on stderr is the whole difference between a fallback and a lie.
   */
  it("falls back to what it has, and says so out loud", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    await loadManifest(URL, { directory, fetch, warn });
    state.answering = false;

    const stale = await loadManifest(URL, { directory, fetch, warn, refresh: true });
    expect(stale.commands[0]?.summary).toBe("List the pets");
    expect(warnings.join("")).toContain("Using the cached command surface from");
    expect(warnings.join("")).toContain(URL);
  });

  it("falls back on an answer that is not one, not only on silence", async () => {
    const { state, fetch } = server(manifestOf("List the pets"));
    await loadManifest(URL, { directory, fetch, warn });
    state.status = 503;

    await loadManifest(URL, { directory, fetch, warn, refresh: true });
    expect(warnings.length).toBe(1);
  });

  it("keeps one program's surface apart from another's", async () => {
    const one = server(manifestOf("List the pets"));
    const two = server(manifestOf("List the cases"));
    await loadManifest(URL, { directory, fetch: one.fetch, warn });
    const other = await loadManifest("http://other.test/cli-manifest", { directory, fetch: two.fetch, warn });

    expect(other.commands[0]?.summary).toBe("List the cases");
    expect((await readdir(directory)).length).toBe(2);
  });
});
