import { describe, expect, it } from "vitest";
import { coerce, createRegistry, output } from "@facio/commands";
import { Program } from "@facio/terminal";
import { manifestFrom, commandsFrom, type HttpBinding, type Transport } from "./manifest.js";
import { manifestFromOpenApi, type OpenApiDocument } from "./openapi.js";

function service() {
  const registry = createRegistry({ groups: [{ name: "pets", title: "Pets" }] })
    .provide("pets", { resolve: () => [{ id: "1", name: "Ada" }] });
  registry.register(registry.command({
    id: "pet.list",
    group: "pets",
    pattern: ["pet", "list"],
    summary: "List the pets",
    needs: ["pets"],
    options: [{ name: "--limit", value: "N", description: "How many", coerce: coerce.integer({ min: 1, max: 100 }) }],
    meta: { http: { method: "GET", path: "/pets", query: ["limit"] } satisfies HttpBinding },
    run: (context) => output(context.pets),
  }));
  return registry;
}

describe("the round trip", () => {
  it("describes a registry and builds it back into the same command", async () => {
    const manifest = manifestFrom(service(), { name: "pets", version: "1.0.0" });
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.commands[0]?.options?.[0]).toMatchObject({
      name: "--limit",
      // The schema travels whole, so a client holds the value to the rule the
      // service declared rather than to a flattening of it.
      schema: { type: "integer", minimum: 1, maximum: 100 },
    });

    const calls: { binding: HttpBinding; input: Record<string, unknown> }[] = [];
    const transport: Transport = {
      request: (binding, input) => { calls.push({ binding, input: { ...input } }); return Promise.resolve([{ id: "1" }]); },
    };

    const client = createRegistry().provide("transport", { resolve: () => transport });
    client.register(...commandsFrom(manifest));

    const out: string[] = [];
    const program = new Program({
      name: "client", version: "0", registry: client,
      io: { out: (text) => { out.push(text); }, err: () => {} },
    });

    expect(await program.run(["pet", "list", "--limit", "5", "--json"])).toBe(0);
    expect(calls[0]?.binding.path).toBe("/pets");
    expect(calls[0]?.input).toEqual({ limit: 5 });
    expect(JSON.parse(out.join(""))).toEqual([{ id: "1" }]);
  });

  it("refuses locally what the server would have refused, because the bounds travel", async () => {
    const manifest = manifestFrom(service(), { name: "pets", version: "1.0.0" });
    const client = createRegistry().provide("transport", {
      resolve: (): Transport => ({ request: () => Promise.reject(new Error("must not be called")) }),
    });
    client.register(...commandsFrom(manifest));
    const program = new Program({ name: "client", version: "0", registry: client, io: { out: () => {}, err: () => {} } });
    await expect(program.run(["pet", "list", "--limit", "999"])).rejects.toThrow(/--limit must be an integer/u);
  });

  it("publishes only the commands that carry a binding", () => {
    const registry = service();
    registry.register({ id: "local", pattern: ["doctor"], summary: "", group: "pets", run: () => {} });
    const manifest = manifestFrom(registry, { name: "pets", version: "1.0.0" });
    expect(manifest.commands.map((command) => command.id)).toEqual(["pet.list"]);
  });
});

describe("reading OpenAPI", () => {
  const document: OpenApiDocument = {
    info: { title: "petstore", version: "1.0.0" },
    paths: {
      "/pets": {
        get: {
          operationId: "listPets", tags: ["pets"], summary: "List the pets",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1 } }],
        },
      },
      "/pets/{id}": {
        get: {
          operationId: "showPetById", tags: ["pets"], summary: "Show one pet",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        },
      },
      "/internal/metrics": { get: { operationId: "metrics", "x-cli": { skip: true }, summary: "" } },
    },
  };

  it("names commands by path, and takes path parameters as slots", () => {
    const manifest = manifestFromOpenApi(document);
    expect(manifest.commands.map((command) => command.pattern.join(" ")))
      .toEqual(["pets", "pets :id"]);
  });

  it("leaves out what the document asked to leave out", () => {
    const manifest = manifestFromOpenApi(document);
    expect(manifest.commands.some((command) => command.id === "metrics")).toBe(false);
  });

  it("honours an x-cli pattern over the derived one", () => {
    const manifest = manifestFromOpenApi({
      paths: { "/pets": { post: { operationId: "createPet", tags: ["pets"], "x-cli": { pattern: ["pet", "new"] } } } },
    });
    expect(manifest.commands[0]?.pattern).toEqual(["pet", "new"]);
  });
});
