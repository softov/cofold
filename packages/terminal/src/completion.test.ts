/**
 * What could come next.
 *
 * Completion is the surface nobody reads the code of and everybody notices when
 * it is wrong, and it is the one place where being useless is worse than being
 * absent. It is also derived from the same declaration as everything else, so
 * what it offers is a fair test of whether that declaration says enough.
 */

import { describe, expect, it } from "vitest";
import { createRegistry, type Command } from "@doopx/commands";
import { globalOptions } from "./globals.js";
import { COMPLETION_SHELLS, completeWords, completionScript } from "./completion.js";

const registry = createRegistry();

const commands: Command[] = [
  registry.action({
    id: "note.list",
    summary: "List notes",
    input: {
      status: { type: "string", enum: ["open", "done"], description: "Only this status" },
      limit: { type: "integer", minimum: 1, description: "How many" },
    },
    surfaces: { cli: { pattern: ["note", "list"] } },
    run: () => {},
  }),
  registry.action({
    id: "note.show",
    summary: "Show one note",
    input: {
      id: {
        type: "string",
        description: "Which note",
        cli: { complete: () => ["n1", "n2", "other"] },
      },
    },
    required: ["id"],
    surfaces: { cli: { pattern: ["note", "show", ":id"] } },
    run: () => {},
  }),
  registry.command({
    id: "note.secret",
    pattern: ["note", "secret"],
    summary: "Not for humans",
    hidden: true,
    run: () => {},
  }),
  registry.command({
    id: "doctor",
    pattern: ["doctor"],
    summary: "Check the setup",
    run: () => {},
  }),
];

const complete = async (words: string[], current = ""): Promise<string[]> =>
  await completeWords(commands, globalOptions, words, current);

describe("words", () => {
  it("offers the first word of every command, at the start", async () => {
    expect(await complete([])).toEqual(["doctor", "note"]);
  });

  it("offers what comes after a prefix", async () => {
    expect(await complete(["note"])).toEqual(["list", "show"]);
  });

  it("narrows to what has been typed so far", async () => {
    expect(await complete(["note"], "l")).toEqual(["list"]);
  });

  /*
   * Hidden means hidden. A command kept out of help and offered by the shell
   * is a command that is not really hidden, only undocumented.
   */
  it("never offers a hidden command", async () => {
    expect(await complete(["note"])).not.toContain("secret");
  });
});

describe("options", () => {
  it("offers a command's own options and the global ones together", async () => {
    const offered = await complete(["note", "list"], "--");
    expect(offered).toContain("--status");
    expect(offered).toContain("--limit");
    expect(offered).toContain("--json");
  });

  it("offers only the options of the command that was matched", async () => {
    expect(await complete(["doctor"], "--")).not.toContain("--status");
  });
});

describe("values", () => {
  /*
   * The enum is the set, so it is the completion source too. A set written
   * once and completed from somewhere else is a set that drifts.
   */
  it("completes an option's value from the set its schema names", async () => {
    expect(await complete(["note", "list", "--status"])).toEqual(["open", "done"]);
    expect(await complete(["note", "list", "--status"], "d")).toEqual(["done"]);
  });

  it("offers nothing for a value it cannot know", async () => {
    expect(await complete(["note", "list", "--limit"])).toEqual([]);
  });

  it("asks the running program for the candidates of a slot", async () => {
    expect(await complete(["note", "show"])).toEqual(["n1", "n2", "other"]);
    expect(await complete(["note", "show"], "n")).toEqual(["n1", "n2"]);
  });

  /*
   * A completion that throws prints a stack trace into somebody's prompt, so
   * a broken source is worth exactly nothing and never worth an error.
   */
  it("says nothing at all when a source fails", async () => {
    const broken = [registry.command({
      id: "x",
      pattern: ["x", ":id"],
      summary: "x",
      arguments: { id: { description: "", complete: () => { throw new Error("no"); } } },
      run: () => {},
    })];
    expect(await completeWords(broken, globalOptions, ["x"], "")).toEqual([]);
  });
});

describe("the shell side", () => {
  it("writes a script for every shell it claims to support", () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = completionScript(shell, "notes");
      expect(script.length).toBeGreaterThan(0);
      expect(script).toContain("notes");
    }
  });

  it("refuses a shell it does not know, rather than writing something that half works", () => {
    expect(() => completionScript("csh", "notes")).toThrow();
  });
});
