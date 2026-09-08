#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRegistry } from "facio";
import { Program, runEntry } from "facio/cli";
import { httpTransport, manifestFromOpenApi, commandsFrom } from "facio/remote";

/**
 * `open-cli` - a command line for an API that never heard of this library.
 *
 * The honest caveat first: a generated CLI that mirrors a REST API one-for-one
 * is usually worse than curl. Four hundred endpoints are not four hundred
 * commands, and the operation ids are the server's internal names, not words a
 * person would look for. So the mapping is a default and the document gets to
 * override it - `x-cli` on an operation names the words, the group, or asks to
 * be left out entirely, and `/internal/metrics` in the sample does exactly that.
 *
 * What this demonstrates is that the OpenAPI reader stops early: it produces a
 * *manifest*, and everything after that - commands, help, completion, `--json`,
 * exit codes - is the same code the native path uses.
 */

const VERSION = "0.1.0";

function readGlobal(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at !== -1 && argv[at + 1] !== undefined) return argv[at + 1];
  return argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function build(argv: readonly string[]): Promise<Program> {
  const specPath = readGlobal(argv, "--spec") ?? process.env["OPENAPI_SPEC"];
  if (specPath === undefined) {
    process.stderr.write("open-cli: --spec PATH is required (an OpenAPI 3 document)\n");
    process.exit(2);
  }

  const document = JSON.parse(
    specPath.startsWith("http")
      ? await (await fetch(specPath)).text()
      : readFileSync(specPath, "utf8"),
  ) as Record<string, unknown>;

  const manifest = manifestFromOpenApi(document, {});
  const servers = document["servers"] as { url?: string }[] | undefined;
  const baseUrl = readGlobal(argv, "--base-url") ?? servers?.[0]?.url ?? "http://127.0.0.1";

  const groups = [...new Set(manifest.commands.map((command) => command.group))]
    .filter((group): group is string => group !== undefined)
    .map((group) => ({ name: group, title: group, agent: true }));

  const registry = createRegistry({ groups }).provide("transport", {
    description: `HTTP against ${baseUrl}`,
    resolve: () => httpTransport({ baseUrl, timeoutMs: 10_000 }),
  });

  registry.register(...commandsFrom(manifest, { capability: "transport" }));

  return new Program({
    name: "open-cli",
    version: VERSION,
    description: `${manifest.program.name} ${manifest.program.version}, as a command line.`,
    registry,
    globals: [
      { name: "--spec", value: "PATH", description: "The OpenAPI document", env: "OPENAPI_SPEC" },
      { name: "--base-url", value: "URL", description: "Override the server in the document" },
    ],
  });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const argv = process.argv.slice(2);
  await runEntry(await build(argv), argv);
}

export { build };
