#!/usr/bin/env node
/**
 * petshop - the declaration shape on all three surfaces at once.
 *
 * Every action here is declared once. `petshop pet add` is the command line
 * reading of it, `petshop mcp tools` prints the MCP tool it becomes, and
 * `petshop serve` answers the same action over HTTP. The constraints - a name
 * of 1 to 40 characters, an age between 0 and 30, a breed from a fixed set -
 * are written in one place and enforced on all three.
 */

import { createServer } from "node:http";
import { createRegistry, output, ArgumentError } from "@doopx/commands";
import { Program, renderTable, runEntry } from "@doopx/terminal";
import { listTools } from "@doopx/mcp";
import { canonicalFromObject } from "@doopx/commands";
import { manifestFrom } from "@doopx/remote";

export interface Pet {
  id: string;
  name: string;
  age?: number;
  breed: string;
  tags: string[];
}

/** The store, as a capability: one array for the life of the process. */
const pets: Pet[] = [
  { id: "1", name: "Ada", breed: "corgi", age: 4, tags: ["office"] },
  { id: "2", name: "Byte", breed: "beagle", age: 2, tags: [] },
];

const registry = createRegistry().provide("pets", {
  resolve: () => ({
    all: (): Pet[] => pets,
    add: (pet: Omit<Pet, "id">): Pet => {
      const made = { id: String(pets.length + 1), ...pet };
      pets.push(made);
      return made;
    },
    get: (id: string): Pet => {
      const found = pets.find((one) => one.id === id);
      if (found === undefined) throw new ArgumentError(`There is no pet ${id}`);
      return found;
    },
  }),
});

registry.action({
  id: "pet.list",
  group: "pets",
  summary: "List the pets",
  needs: ["pets"],
  input: {},
  surfaces: {
    cli: { pattern: ["pet", "list"] },
    http: { method: "GET", path: "/pets" },
    mcp: true,
  },
  run: ({ pets: store }) => output(
    store.all(),
    () => renderTable(["id", "name", "breed", "age"],
      store.all().map((pet) => [pet.id, pet.name, pet.breed, pet.age ?? ""])),
  ),
});

registry.action({
  id: "pet.add",
  group: "pets",
  summary: "Add a pet",
  needs: ["pets"],

  input: {
    name: {
      type: "string",
      description: "What it answers to",
      minLength: 1,
      maxLength: 40,
    },
    age: {
      type: "integer",
      description: "How old",
      minimum: 0,
      maximum: 30,
      cli: { short: "-a", value: "YEARS" },
    },
    breed: {
      type: "string",
      description: "Which breed",
      enum: ["beagle", "corgi", "mixed"],
      default: "mixed",
      cli: { short: "-b", value: "BREED" },
    },
    tags: {
      type: "array",
      description: "Tag it",
      items: { type: "string", maxLength: 20 },
      default: [],
      cli: { flag: "--tag", short: "-t", value: "TAG" },
    },
  },
  required: ["name"],

  surfaces: {
    cli: { pattern: ["pet", "add", ":name"] },
    http: { method: "POST", path: "/pets" },
    mcp: true,
  },

  run: ({ input, pets: store }) =>
    output(store.add({
      name: input.name,
      breed: input.breed,
      tags: input.tags,
      ...(input.age === undefined ? {} : { age: input.age }),
    })),
});

registry.action({
  id: "pet.show",
  group: "pets",
  summary: "Show one pet",
  needs: ["pets"],
  input: { id: { type: "string", description: "The pet's id", minLength: 1 } },
  required: ["id"],
  surfaces: {
    cli: { pattern: ["pet", "show", ":id"] },
    http: { method: "GET", path: "/pets/{id}" },
    mcp: true,
  },
  run: ({ input, pets: store }) => output(store.get(input.id)),
});

registry.action({
  id: "mcp.tools",
  group: "meta",
  summary: "Print the MCP tools this program would serve",
  surfaces: { cli: { pattern: ["mcp", "tools"] } },
  run: () => output(listTools(registry)),
});

registry.action({
  id: "serve",
  group: "meta",
  summary: "Answer the same actions over HTTP",
  input: { port: { type: "integer", description: "Which port", minimum: 1, maximum: 65535, default: 8799 } },
  surfaces: { cli: { pattern: ["serve"] } },
  run: (context) => {
    const { port } = context.input;
    const manifest = manifestFrom(registry, { name: "petshop", version: "0.1.0" });

    createServer((request, response) => {
      void (async (): Promise<void> => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        const send = (status: number, body: unknown): void => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(`${JSON.stringify(body, null, 2)}\n`);
        };

        if (url.pathname === "/cli-manifest") { send(200, manifest); return; }

        for (const described of manifest.commands) {
          const shape = described.http.path.replaceAll(/\{[^}]+\}/gu, "([^/]+)");
          const found = new RegExp(`^${shape}$`, "u").exec(url.pathname);
          if (found === null || described.http.method !== (request.method ?? "GET")) continue;

          const names = [...described.http.path.matchAll(/\{([^}]+)\}/gu)].map((one) => one[1]!);
          const slots = Object.fromEntries(names.map((name, at) => [name, decodeURIComponent(found[at + 1]!)]));
          const command = registry.find(described.id)!;

          try {
            const body = request.method === "GET" || request.method === "DELETE"
              ? {}
              : JSON.parse(await new Promise<string>((done) => {
                let text = "";
                request.on("data", (chunk) => { text += String(chunk); });
                request.on("end", () => done(text === "" ? "{}" : text));
              })) as Record<string, unknown>;
            const query = Object.fromEntries([...url.searchParams.keys()].map((key) => [key, url.searchParams.get(key)]));
            const input = await canonicalFromObject(command, { ...query, ...body, ...slots });
            const result = await registry.execute(command, { surface: "remote", input });
            send(200, result?.data ?? null);
          } catch (error: unknown) {
            const argument = (error as { kind?: string }).kind === "argument";
            send(argument ? 400 : 500, { message: error instanceof Error ? error.message : "Failed" });
          }
          return;
        }
        send(404, { message: `No route for ${request.method} ${url.pathname}` });
      })();
    }).listen(port, "127.0.0.1", () => {
      context.write(`petshop on http://127.0.0.1:${port} (manifest at /cli-manifest)\n`);
    });

    return output(null, "");
  },
});

export const program = new Program({
  name: "petshop",
  version: "0.1.0",
  description: "One declaration, three surfaces.",
  registry,
});

export { registry };

if (process.argv[1]?.endsWith("cli.js") === true) {
  await runEntry(program, process.argv.slice(2));
}
