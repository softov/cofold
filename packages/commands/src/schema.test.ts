/**
 * Validation that is somebody else's, and stays that way.
 *
 * `refine` takes any Standard Schema, and the point of vendoring the interface
 * rather than importing a library is that none of zod, valibot or arktype is
 * installed here. So the schema under test is written by hand: if these pass,
 * anything that implements `~standard` works, which is the whole claim.
 */

import type { StandardIssue, StandardSchema } from "@doopx/sdk";
import { describe, expect, it } from "vitest";
import { canonicalFromCli, canonicalFromObject } from "./input.js";
import { createRegistry } from "./registry.js";
import { isStandardSchema, validate } from "./schema.js";
import { ArgumentError } from "./errors.js";
import { coerce } from "./index.js";

/** A Standard Schema in nine lines, which is all the spec asks for. */
function schemaOf<T>(check: (value: T) => readonly StandardIssue[]): StandardSchema<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "handwritten",
      validate: (value: unknown) => {
        const issues = check(value as T);
        return issues.length === 0 ? { value: value as T } : { issues };
      },
    },
  };
}

describe("recognising one", () => {
  it("knows a schema from anything else, without knowing whose it is", () => {
    expect(isStandardSchema(schemaOf(() => []))).toBe(true);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema("~standard")).toBe(false);
  });
});

describe("what it reports", () => {
  it("gives the value back when there is nothing to say", async () => {
    const value = await validate(schemaOf(() => []), { a: 1 }, (message) => new Error(message));
    expect(value).toEqual({ a: 1 });
  });

  /*
   * Every issue, not the first. Somebody who mistyped two options should be
   * told about two options rather than made to run the command again to find
   * the second one.
   */
  it("reports every issue at once", async () => {
    const schema = schemaOf(() => [{ message: "since is wrong" }, { message: "until is wrong" }]);
    await expect(validate(schema, {}, (message) => new ArgumentError(message)))
      .rejects.toThrow("since is wrong; until is wrong");
  });

  it("says where an issue was, in either shape the spec allows for a path", async () => {
    const schema = schemaOf(() => [
      { message: "too small", path: ["window", "days"] },
      { message: "unknown", path: [{ key: "target" }] },
    ]);
    await expect(validate(schema, {}, (message) => new Error(message)))
      .rejects.toThrow("window.days: too small; target: unknown");
  });

  it("fails the way the caller asked it to", async () => {
    await expect(validate(schemaOf(() => [{ message: "no" }]), {}, (m) => new ArgumentError(m)))
      .rejects.toBeInstanceOf(ArgumentError);
  });

  it("waits for a schema that answers asynchronously", async () => {
    const schema: StandardSchema<unknown, string> = {
      "~standard": {
        version: 1,
        vendor: "handwritten",
        validate: async () => Promise.resolve({ issues: [{ message: "late" }] }),
      },
    };
    await expect(validate(schema, {}, (message) => new Error(message))).rejects.toThrow("late");
  });
});

describe("refine, on a command", () => {
  /*
   * The rule per-field schemas cannot state: two options that are fine alone
   * and wrong together. It runs after coercion, on the canonical object, so it
   * sees the same thing on every surface - which is why the message names the
   * fields rather than the flags.
   */
  const registry = createRegistry();
  const command = registry.command({
    id: "note.list",
    pattern: ["note", "list"],
    summary: "List notes",
    options: [
      { name: "--since", value: "DATE", description: "From", coerce: coerce.text },
      { name: "--until", value: "DATE", description: "To", coerce: coerce.text },
    ],
    refine: schemaOf<{ since?: string; until?: string }>((value) =>
      value.since !== undefined && value.until !== undefined
        ? [{ message: "Give one of since or until, not both" }]
        : []),
    run: () => {},
  });

  it("lets through what it has nothing to say about", async () => {
    expect(await canonicalFromCli(command, { slots: {}, options: { "--since": "monday" } }))
      .toEqual({ since: "monday" });
  });

  it("refuses the combination, at a terminal", async () => {
    await expect(canonicalFromCli(command, { slots: {}, options: { "--since": "a", "--until": "b" } }))
      .rejects.toThrow("Give one of since or until, not both");
  });

  it("refuses the same combination when it arrived as an object", async () => {
    await expect(canonicalFromObject(command, { since: "a", until: "b" }))
      .rejects.toThrow("Give one of since or until, not both");
  });
});
