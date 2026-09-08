/**
 * One YAML file, three surfaces, one rulebook.
 *
 * The claim `s2cmd` exists to prove: a document this library did not author
 * becomes actions, and everything downstream - the terminal, an HTTP route, an
 * MCP tool - is a rendering of that one declaration. The point is not that any
 * one of them validates, but that none of them can be made to disagree, exactly
 * as in `examples/petshop`, with nobody having written a handler.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalFromCli, canonicalFromObject } from "facio";
import { listTools } from "facio/mcp";
import { manifestFrom } from "facio/remote";
import { registryFor } from "./cli.js";
import { loadDocument, parseEnvFile } from "./load.js";

const path = fileURLToPath(new URL("../samples/depot.yaml", import.meta.url));
const loaded = loadDocument(path);
const { registry } = registryFor(loaded.document, {
  directory: loaded.directory,
  environment: loaded.environment,
});
const add = registry.find("pet.add")!;
const long = "x".repeat(41);

describe("the document, composed", () => {
  it("applies the imports before the file that imported them", () => {
    expect(loaded.files.map((one) => one.split("/").pop()))
      .toEqual(["depot.defaults.yaml", "depot.yaml"]);
    expect(loaded.document["config"]).toMatchObject({ api: "http://127.0.0.1:8799" });
  });

  it("passes over a file that said it might not be there", () => {
    expect(loaded.files.some((one) => one.endsWith("depot.local.yaml"))).toBe(false);
    expect(loaded.environment["RELEASE_CHANNEL"]).toBe("stable");
  });

  it("resolves imports and env away, so the reader takes a composed document", () => {
    expect(loaded.document["imports"]).toBeUndefined();
    expect(loaded.document["env"]).toBeUndefined();
  });
});

describe("the schema is the only rulebook", () => {
  it("holds a length on the command line", async () => {
    await expect(canonicalFromCli(add, { slots: { name: [long] }, options: {} }))
      .rejects.toThrow("must be 1 to 40 characters");
  });

  it("holds the same length on an object, which is what HTTP and MCP send", async () => {
    await expect(canonicalFromObject(add, { name: long }))
      .rejects.toThrow("must be 1 to 40 characters");
  });

  it("holds a bound on a value that arrived as a JSON number", async () => {
    await expect(canonicalFromObject(add, { name: "Rex", age: 40 }))
      .rejects.toThrow("must be an integer between 0 and 30");
  });

  it("holds an enum the document declared", async () => {
    await expect(canonicalFromObject(add, { name: "Rex", breed: "poodle" }))
      .rejects.toThrow("must be one of beagle, corgi, mixed");
  });

  it("applies the declared default", async () => {
    expect((await canonicalFromObject(add, { name: "Rex" }))["breed"]).toBe("mixed");
  });
});

describe("the MCP surface", () => {
  const tools = listTools(registry).tools;
  const tool = tools.find((one) => one.name === "pet_add")!;
  const properties = (tool.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;

  it("advertises every constraint the document stated", () => {
    expect(properties["name"]).toMatchObject({ type: "string", minLength: 1, maxLength: 40 });
    expect(properties["age"]).toMatchObject({ type: "integer", minimum: 0, maximum: 30 });
    expect(properties["breed"]).toMatchObject({ enum: ["beagle", "corgi", "mixed"], default: "mixed" });
  });

  it("shows an agent nothing about how a terminal spells it", () => {
    for (const property of Object.values(properties)) expect(property["cli"]).toBeUndefined();
  });

  /*
   * The refusal, from the other end. Nothing in the document opted the release
   * commands into being tools, and `release.ship` reaches a process through an
   * `internal` step, so neither is here.
   */
  it("publishes only the commands that run no process", () => {
    expect(tools.map((one) => one.name).sort()).toEqual(["pet_add", "pet_list"]);
  });
});

describe("the HTTP surface", () => {
  const manifest = manifestFrom(registry, { name: "depot", version: "1.0.0" });

  it("publishes the binding the document declared", () => {
    expect(manifest.commands.find((one) => one.id === "pet.add")?.http)
      .toEqual({ method: "POST", path: "/pets" });
  });

  it("routes nothing that runs a process", () => {
    expect(manifest.commands.map((one) => one.id).sort()).toEqual(["pet.add", "pet.list"]);
  });
});

describe("the command line", () => {
  it("still has the commands the other two surfaces withheld", () => {
    const ids = registry.commands.map((one) => one.id);
    expect(ids).toContain("release.deploy");
    expect(ids).toContain("release.ship");
    expect(registry.find("release.deploy")?.surfaces?.cli).toBe(true);
    expect(registry.find("release.deploy")?.surfaces?.mcp).toBe(false);
  });

  it("spells the input as options and slots, from one declaration", () => {
    const command = registry.find("release.build")!;
    const target = command.options?.find((one) => one.name === "--target");
    expect(target?.short).toBe("-t");
    expect(target?.repeatable).toBe(true);
    expect(add.pattern).toEqual(["pet", "add", ":name"]);
  });
});

describe("composing documents", () => {
  const files: Record<string, string> = {
    "/doc/main.yaml": [
      "imports: [base.yaml, over.yaml]",
      "config: { who: main }",
      "commands:",
      "  own:",
      "    summary: Declared here",
      "    run: noop",
    ].join("\n"),
    "/doc/base.yaml": [
      "config: { who: base, kept: yes }",
      "commands:",
      "  shared:",
      "    summary: From base",
      "    run: noop",
    ].join("\n"),
    "/doc/over.yaml": [
      "config: { who: over }",
      "commands:",
      "  shared:",
      "    summary: From over",
      "    run: noop",
    ].join("\n"),
  };

  const read = (one: string): string => {
    const text = files[one];
    if (text === undefined) throw Object.assign(new Error(`no ${one}`), { code: "ENOENT" });
    return text;
  };

  it("lets a later import win, and the importing file win over all of them", () => {
    const composed = loadDocument("/doc/main.yaml", { readFile: read, environment: {} });
    expect(composed.document["config"]).toEqual({ who: "main", kept: "yes" });
    expect((composed.document["commands"] as Record<string, { summary: string }>)["shared"]?.summary)
      .toBe("From over");
  });

  it("refuses documents that import each other", () => {
    const circular = {
      "/doc/a.yaml": "imports: [b.yaml]\ncommands:\n  a:\n    summary: A\n    run: noop\n",
      "/doc/b.yaml": "imports: [a.yaml]\ncommands:\n  b:\n    summary: B\n    run: noop\n",
    } as Record<string, string>;
    expect(() => loadDocument("/doc/a.yaml", {
      readFile: (one) => circular[one] ?? "",
      environment: {},
    })).toThrow("import each other");
  });
});

describe("environment files", () => {
  it("reads the small, boring subset", () => {
    expect(parseEnvFile([
      "# a comment",
      "",
      "PLAIN=one",
      "export EXPORTED=two",
      'QUOTED="three four"',
      "TRAILING=five # not part of it",
    ].join("\n"))).toEqual({
      PLAIN: "one",
      EXPORTED: "two",
      QUOTED: "three four",
      TRAILING: "five",
    });
  });
});
