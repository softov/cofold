/**
 * Each example CLI starts when it is run through a symlink.
 *
 * npm installs a bin as a link, so `process.argv[1]` is the link and not the
 * file the module was loaded from. An entry guard that compares the two
 * without resolving the link exits 0 and prints nothing.
 *
 * Runs the built files, which `pnpm test` builds first.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const EXAMPLES: readonly { name: string; args: readonly string[] }[] = [
  { name: "open-cli", args: ["--spec", fileURLToPath(new URL("./samples/petstore.json", import.meta.url))] },
  { name: "kitchen-sink", args: [] },
  { name: "clerver", args: [] },
  { name: "petshop", args: [] },
  { name: "wizard", args: [] },
];

const links = mkdtempSync(join(tmpdir(), "cofold-bin-"));
afterAll(() => rmSync(links, { recursive: true, force: true }));

describe("an example started through a symlink", () => {
  for (const example of EXAMPLES) {
    it(`runs ${example.name}`, () => {
      const target = fileURLToPath(new URL(`./dist/${example.name}/cli.js`, import.meta.url));
      expect(existsSync(target), `${target} is not built; run pnpm examples`).toBe(true);
      const link = join(links, example.name);
      symlinkSync(target, link);
      const result = spawnSync(process.execPath, [link, ...example.args, "--version"], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  }
});
