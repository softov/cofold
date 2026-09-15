/**
 * What the declaration shape has to be true for.
 *
 * One action, three surfaces, and the same rules on each: the point is not that
 * any one of them validates, but that none of them can be made to disagree,
 * because there is one schema behind all three.
 */

import { describe, expect, it } from "vitest";
import { canonicalFromCli, canonicalFromObject, check, expectationOf } from "@facio/commands";
import { callTool, listTools } from "@facio/mcp";
import { manifestFrom } from "@facio/remote";
import { registry } from "./cli.js";

const add = registry.find("pet.add")!;
const long = "x".repeat(41);

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

  it("holds an enum", async () => {
    await expect(canonicalFromObject(add, { name: "Rex", breed: "poodle" }))
      .rejects.toThrow("must be one of beagle, corgi, mixed");
  });

  it("holds a constraint on the items of a list", async () => {
    await expect(canonicalFromObject(add, { name: "Rex", tags: ["ok", "y".repeat(21)] }))
      .rejects.toThrow("must be at most 20 characters");
  });

  it("applies the declared defaults", async () => {
    const input = await canonicalFromObject(add, { name: "Rex" });
    expect(input["breed"]).toBe("mixed");
    expect(input["tags"]).toEqual([]);
  });
});

describe("the MCP surface", () => {
  const tool = listTools(registry).tools.find((one) => one.name === "pet_add")!;
  const schema = tool.inputSchema as { properties: Record<string, Record<string, unknown>>; required?: string[] };
  const properties = schema.properties;

  it("advertises every constraint it enforces", () => {
    expect(properties["name"]).toMatchObject({ type: "string", minLength: 1, maxLength: 40 });
    expect(properties["age"]).toMatchObject({ type: "integer", minimum: 0, maximum: 30 });
    expect(properties["breed"]).toMatchObject({ enum: ["beagle", "corgi", "mixed"], default: "mixed" });
    expect(properties["tags"]).toMatchObject({ type: "array", items: { type: "string", maxLength: 20 } });
  });

  it("says which fields are required", () => {
    expect(schema.required).toEqual(["name"]);
  });

  it("shows an agent nothing about how a terminal spells it", () => {
    for (const property of Object.values(properties)) expect(property["cli"]).toBeUndefined();
  });

  /*
   * Reported to the agent rather than thrown at the host: a broken argument is
   * something the caller can fix, so MCP answers with `isError` and the reason.
   */
  it("refuses a call that breaks a rule it advertised", async () => {
    const answer = await callTool(registry, "pet_add", { name: "Rex", age: 40 });
    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain("must be an integer between 0 and 30");
  });

  it("runs a call that keeps them", async () => {
    const answer = await callTool(registry, "pet_add", { name: "Fine", age: 2, breed: "corgi" });
    expect(JSON.stringify(answer)).toContain("Fine");
  });
});

describe("the HTTP surface", () => {
  const manifest = manifestFrom(registry, { name: "petshop", version: "0.1.0" });

  it("publishes the binding the action declared", () => {
    const described = manifest.commands.find((one) => one.id === "pet.add")!;
    expect(described.http).toEqual({ method: "POST", path: "/pets" });
  });

  it("publishes only the actions that declared one", () => {
    expect(manifest.commands.map((one) => one.id).sort()).toEqual(["pet.add", "pet.list", "pet.show"]);
  });
});

describe("check, on its own", () => {
  it("reads a schema back as the sentence a person is shown", () => {
    expect(expectationOf({ type: "integer", minimum: 0, maximum: 30 })).toBe("an integer between 0 and 30");
    expect(expectationOf({ type: "string", minLength: 1, maxLength: 40 })).toBe("1 to 40 characters");
    expect(expectationOf({ type: "string", enum: ["a", "b"] })).toBe("one of a, b");
    expect(expectationOf({ type: "string", pattern: "^a" })).toBe("text matching ^a");
  });

  it("enforces a pattern", () => {
    expect(() => check("bad", { type: "string", pattern: "^a" }, "x")).toThrow("text matching ^a");
    expect(() => check("all", { type: "string", pattern: "^a" }, "x")).not.toThrow();
  });

  it("refuses a value of the wrong type outright", () => {
    expect(() => check("3", { type: "integer" }, "x")).toThrow();
    expect(() => check(3, { type: "string" }, "x")).toThrow();
  });
});
