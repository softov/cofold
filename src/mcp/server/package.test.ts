import { expect, it } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("keeps every entry point but the SDK server importable with no dependencies installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "facio-package-"));
  try {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    await cp(join(root, "dist"), join(directory, "dist"), { recursive: true });
    await writeFile(join(directory, "package.json"), await readFile(join(root, "package.json")));
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      for (const name of ['facio', 'facio/cli', 'facio/mcp', 'facio/mcp/stdio', 'facio/remote', 'facio/config', 'facio/docs', 'facio/yaml']) await import(name);
      const { serveStdio } = await import('facio/mcp/stdio');
      if (typeof serveStdio !== 'function') process.exit(3);
      try { await import('facio/mcp/server'); process.exit(2); }
      catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
      process.stdout.write('ok');
    `], { cwd: directory, encoding: "utf8" });
    expect(result).toBe("ok");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
