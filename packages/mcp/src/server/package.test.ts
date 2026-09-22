import { expect, it } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The claim under test is the one in the README: the stdio server needs nothing
 * installed, and the SDK server is the only entry point that does. So the
 * package is staged the way npm would leave it - its own `dist`, its one
 * dependency under `node_modules`, and no SDK - and every entry point is
 * imported from there.
 */
it("keeps every entry point but the SDK server importable with no dependencies installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "facio-mcp-package-"));
  try {
    const packages = fileURLToPath(new URL("../../../", import.meta.url));
    await cp(join(packages, "mcp", "dist"), join(directory, "dist"), { recursive: true });
    await writeFile(join(directory, "package.json"), await readFile(join(packages, "mcp", "package.json")));
    for (const name of ["commands", "sdk"]) {
      const staged = join(directory, "node_modules", "@facio", name);
      await mkdir(staged, { recursive: true });
      await cp(join(packages, name, "dist"), join(staged, "dist"), { recursive: true });
      await writeFile(join(staged, "package.json"), await readFile(join(packages, name, "package.json")));
    }
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      for (const name of ['@doopx/mcp', '@doopx/mcp/stdio']) await import(name);
      const { serveStdio } = await import('@doopx/mcp/stdio');
      if (typeof serveStdio !== 'function') process.exit(3);
      try { await import('@doopx/mcp/server'); process.exit(2); }
      catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
      process.stdout.write('ok');
    `], { cwd: directory, encoding: "utf8" });
    expect(result).toBe("ok");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
