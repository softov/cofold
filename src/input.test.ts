import { afterEach, describe, expect, it } from "vitest";
import { canonicalFromCli, canonicalFromObject } from "./input.js";
import * as coerce from "./coerce.js";
import type { Command } from "./command.js";

const command: Command = {
  id: "case.list",
  pattern: ["case", "list", ":project", ":ids..."],
  summary: "",
  arguments: { ids: { coerce: coerce.integer({ min: 1 }) } },
  options: [
    { name: "--limit", value: "N", description: "", coerce: coerce.integer({ min: 1 }), default: 20 },
    { name: "--tag", value: "TAG", description: "", repeatable: true },
    { name: "--url", value: "URL", description: "", env: "TEST_URL" },
    { name: "--dry-run", description: "" },
    { name: "--status", value: "S", description: "", coerce: coerce.oneOf(["open", "done"]) },
  ],
  run: () => {},
};

afterEach(() => { delete process.env["TEST_URL"]; });

describe("the canonical input", () => {
  it("coerces slots, collects what is repeatable, and applies defaults", async () => {
    const input = await canonicalFromCli(command, {
      slots: { project: "brb", ids: ["3", "4"] },
      options: { "--tag": ["a", "b"] },
    });
    expect(input).toEqual({ project: "brb", ids: [3, 4], limit: 20, tag: ["a", "b"], dryRun: false });
  });

  it("names a field the way an object would: --dry-run becomes dryRun", async () => {
    const input = await canonicalFromCli(command, {
      slots: { project: "brb", ids: ["1"] },
      options: { "--dry-run": true },
    });
    expect(input["dryRun"]).toBe(true);
  });

  it("prefers what was typed over the environment, and the environment over the default", async () => {
    process.env["TEST_URL"] = "https://from-env.test";
    const fromEnv = await canonicalFromCli(command, { slots: { project: "p", ids: ["1"] }, options: {} });
    expect(fromEnv["url"]).toBe("https://from-env.test");

    const typed = await canonicalFromCli(command, {
      slots: { project: "p", ids: ["1"] },
      options: { "--url": "https://typed.test" },
    });
    expect(typed["url"]).toBe("https://typed.test");
  });

  it("refuses a value the coercer does not accept, by the name that was typed", async () => {
    await expect(canonicalFromCli(command, {
      slots: { project: "p", ids: ["1"] },
      options: { "--status": "half" },
    })).rejects.toThrow("--status must be one of open, done");
  });

  it("refuses a missing required slot", async () => {
    await expect(canonicalFromCli(command, { slots: { ids: ["1"] }, options: {} }))
      .rejects.toThrow("project is required");
  });

  it("reads an already-typed object the same way, coercing only what arrived as text", async () => {
    const input = await canonicalFromObject(command, { project: "p", ids: [1, "2"], limit: "5" });
    expect(input).toEqual({ project: "p", ids: [1, 2], limit: 5, dryRun: false });
  });

  it("fills a declared field from standard input when nothing was given for it", async () => {
    const withStdin: Command = { ...command, stdin: "project", pattern: ["case", "list", ":project?"] };
    const input = await canonicalFromCli(withStdin, { slots: {}, options: {}, stdin: "piped" });
    expect(input["project"]).toBe("piped");
  });
});
