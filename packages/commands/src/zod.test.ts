import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonSchema } from "@cofold/sdk";
import { check } from "./coerce.js";
import { assertSupportedSchema } from "@cofold/sdk";

/**
 * What Zod writes is what a command declares.
 *
 * `JsonSchema` is the family's one definition, and the claim that it matches
 * what `z.toJSONSchema()` emits is tested rather than promised: the ordinary
 * shapes must be carried unchanged and enforced the way Zod would enforce them.
 */
describe("a schema Zod wrote", () => {
  const pet = z.object({
    name: z.string().min(1).max(40),
    age: z.number().int().min(0).optional(),
    breed: z.enum(["beagle", "corgi"]).nullable(),
    tags: z.array(z.string()).max(3).default([]),
    id: z.union([z.string(), z.number().int()]),
  });
  const schema = z.toJSONSchema(pet) as JsonSchema;

  it("is carried without a keyword being refused", () => {
    expect(() => assertSupportedSchema({ schema, path: "pet" })).not.toThrow();
  });

  it("is enforced the way Zod enforces it", () => {
    const good = { name: "Rex", breed: null, tags: [], id: 3 };
    expect(() => check(good, schema, "pet")).not.toThrow();
    expect(pet.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, name: "" },
      { ...good, age: 1.5 },
      { ...good, breed: "poodle" },
      { ...good, tags: ["a", "b", "c", "d"] },
      { ...good, id: true },
      { ...good, extra: 1 },
    ]) {
      expect(() => check(bad, schema, "pet"), JSON.stringify(bad)).toThrow();
      expect(pet.strict().safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
