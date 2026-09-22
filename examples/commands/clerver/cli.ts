#!/usr/bin/env node
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coerce, compact, createRegistry, output, type Command } from "@cofold/commands";
import { Program, runEntry } from "@cofold/terminal";
import { httpTransport, loadManifest, commandsFrom } from "@cofold/remote";
import { createPetServer } from "./server.js";

/**
 * `clerver` - a command line this program did not write.
 *
 * Everything under `pet` below comes from the server, over HTTP, at startup.
 * The local program contributes three things and no more: where to send the
 * requests, what credentials to send, and its own `serve` command. Help,
 * completion, `--json`, coercion and exit codes all work on the remote commands
 * because they are the same `Command` objects a local one would have been.
 *
 * The manifest is cached on disk, so `--help` is not a round trip and the
 * binary still works on a train. `--refresh` re-fetches; a fetch that fails
 * falls back to the cache with a line on stderr, because a stale surface beats
 * no surface and silence about it beats neither.
 */

const VERSION = "0.1.0";
const DEFAULT_URL = "http://127.0.0.1:8787";

async function build(argv: readonly string[]): Promise<Program> {
  const url = readGlobal(argv, "--url") ?? process.env["CLERVER_URL"] ?? DEFAULT_URL;
  const token = process.env["CLERVER_TOKEN"];
  const refresh = argv.includes("--refresh");

  const registry = createRegistry({
    groups: [
      { name: "pets", title: "Pets (from the server)", agent: true },
      { name: "local", title: "This machine", agent: false },
    ],
  }).provide("transport", {
    description: `HTTP against ${url}`,
    resolve: () => httpTransport({
      baseUrl: url,
      timeoutMs: 10_000,
      ...compact({ headers: token === undefined ? undefined : { authorization: `Bearer ${token}` } }),
    }),
  });

  const serve = registry.command({
    id: "serve",
    group: "local",
    pattern: ["serve"],
    summary: "Run the pet service this CLI talks to",
    options: [{ name: "--port", short: "-p", value: "PORT", description: "Listen here", coerce: coerce.integer({ min: 1, max: 65535 }), default: 8787 }],
    examples: [{ command: "clerver serve & clerver pet list", description: "The whole round trip" }],
    run: async (context) => {
      const port = context.value<number>("port");
      const server = createPetServer({ name: "clerver", version: VERSION, description: "A pet service." });
      await new Promise<void>((resolve) => { server.listen(port, "127.0.0.1", resolve); });
      context.error(`Listening on http://127.0.0.1:${port} (manifest at /cli-manifest)`);
      await new Promise<void>(() => { /* until killed */ });
    },
  });

  let remote: Command[] = [];
  // A surface that cannot be reached is not a fatal error here: `serve` is
  // exactly the command somebody runs when there is nothing to reach yet.
  try {
    const manifest = await loadManifest(`${url}/cli-manifest`, {
      directory: join(tmpdir(), "clerver-cache"),
      refresh,
      ttlMs: 5 * 60 * 1000,
      warn: (message) => process.stderr.write(`clerver: ${message}\n`),
      ...compact({ headers: token === undefined ? undefined : { authorization: `Bearer ${token}` } }),
    });
    remote = commandsFrom(manifest, { capability: "transport", expose: () => false });
  } catch (error: unknown) {
    if (!argv.includes("serve")) {
      process.stderr.write(`clerver: ${error instanceof Error ? error.message : "no command surface"}; only local commands are available\n`);
    }
  }

  registry.register(serve, ...remote);

  return new Program({
    name: "clerver",
    version: VERSION,
    description: "A CLI whose commands come from the server it talks to.",
    registry,
    globals: [
      { name: "--url", value: "URL", description: "Where the service is", env: "CLERVER_URL" },
      { name: "--refresh", description: "Re-fetch the command surface" },
    ],
  });
}

/** Read one global before the program exists, because the program depends on it. */
function readGlobal(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at !== -1 && argv[at + 1] !== undefined) return argv[at + 1];
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const argv = process.argv.slice(2);
  await runEntry(await build(argv), argv);
}

export { build, output };
