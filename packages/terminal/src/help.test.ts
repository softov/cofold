/**
 * The rendering everybody reads and nobody maintains.
 *
 * Help is generated from the declaration, so the only way it can be wrong is by
 * leaving something out. What it must not leave out is the part a person cannot
 * guess: the default that will be used, the environment variable that will
 * override nothing, the values an option will actually accept.
 */

import { describe, expect, it } from "vitest";
import { createRegistry, type Command } from "@facio/commands";
import { globalOptions } from "./globals.js";
import { styleFor } from "./render.js";
import { help, helpForCommand, helpForProgram } from "./help.js";

const registry = createRegistry({ groups: [{ name: "work", title: "Work" }] });

const list = registry.action({
  id: "note.list",
  group: "work",
  summary: "List notes, newest first",
  description: "  Reads the store and prints what it finds.  ",
  input: {
    status: { type: "string", enum: ["open", "done"], description: "Only this status", cli: { short: "-s" } },
    limit: { type: "integer", minimum: 1, default: 20, description: "How many", env: "NOTES_LIMIT" },
    secret: { type: "string", description: "Nobody's business", cli: { hidden: true } },
  },
  surfaces: { cli: { pattern: ["note", "list"] } },
  run: () => {},
});

const show = registry.action({
  id: "note.show",
  group: "work",
  summary: "Show one note",
  input: { id: { type: "string", description: "Which note" } },
  required: ["id"],
  surfaces: { cli: { pattern: ["note", "show", ":id"] } },
  run: () => {},
});

const doctor = registry.command({
  id: "doctor",
  pattern: ["doctor"],
  summary: "Check the setup",
  run: () => {},
});

const secret = registry.command({
  id: "doctor.dump",
  pattern: ["doctor", "dump"],
  summary: "Not for humans",
  hidden: true,
  run: () => {},
});

const commands: Command[] = [list, show, doctor, secret];

const options = {
  name: "notes",
  version: "1.2.3",
  description: "Notes, on a command line.",
  commands,
  globals: globalOptions,
  groups: [{ name: "work", title: "Work" }],
  style: styleFor({ color: false }),
};

describe("help for one command", () => {
  const text = helpForCommand(list, options);

  it("opens with the line a person would type", () => {
    expect(text.split("\n")[0]).toBe("Usage: notes note list [options]");
  });

  it("says what it does, then what it does at length", () => {
    expect(text).toContain("List notes, newest first");
    expect(text).toContain("Reads the store and prints what it finds.");
  });

  /*
   * The three facts a person cannot guess and will otherwise discover by being
   * refused: what an option accepts, what it will do if left alone, and what
   * will quietly answer for it from the environment.
   */
  it("shows the candidates, the default and the environment variable", () => {
    expect(text).toContain("open|done");
    expect(text).toContain("default 20");
    expect(text).toContain("env NOTES_LIMIT");
  });

  it("shows a short form where there is one", () => {
    expect(text).toContain("-s, --status");
  });

  it("leaves out a hidden option, which is what hidden means", () => {
    expect(text).not.toContain("--secret");
  });

  it("describes the slots when they were described", () => {
    const shown = helpForCommand(show, options);
    expect(shown).toContain("Usage: notes note show <id>");
    expect(shown).toContain("Which note");
  });
});

describe("help for the program", () => {
  const text = helpForProgram(options);

  it("names itself, its version and what it is for", () => {
    expect(text).toContain("notes 1.2.3 - Notes, on a command line.");
  });

  it("still names itself when nobody gave a version or a description", () => {
    const bare = helpForProgram({ name: "notes", commands, globals: globalOptions, style: options.style });
    expect(bare).toContain("\nnotes\n");
  });

  it("puts a command under the group it declared, by that group's title", () => {
    expect(text).toContain("Work:");
    expect(text).toContain("note list");
  });

  it("lists the global options once, for the whole program", () => {
    expect(text).toContain("--json");
    expect(text).toContain("--quiet");
  });

  it("leaves out a hidden command", () => {
    expect(text).not.toContain("Not for humans");
  });
});

describe("help by prefix", () => {
  it("answers the whole program when nothing was typed", () => {
    expect(help({ ...options, prefix: [] })).toBe(helpForProgram(options));
  });

  it("answers with the command when the prefix names exactly one", () => {
    expect(help({ ...options, prefix: ["note", "list"] })).toBe(helpForCommand(list, options));
  });

  it("lists what is under a prefix that names several", () => {
    const text = help({ ...options, prefix: ["note"] });
    expect(text).toContain("Usage: notes note <command>");
    expect(text).toContain("note list");
    expect(text).toContain("note show");
  });

  /*
   * `report submit --help` parses as `report <id>` with the id "submit", so a
   * slot will happily match a word nobody meant as one. The literal prefix is
   * the better reading and wins; the matched command is only the fallback.
   */
  it("prefers the literal prefix to whatever a slot happened to match", () => {
    expect(help({ ...options, prefix: ["note", "show"], matched: list }))
      .toBe(helpForCommand(show, options));
  });

  it("falls back to the matched command when the prefix names nothing", () => {
    expect(help({ ...options, prefix: ["nonsense"], matched: list }))
      .toBe(helpForCommand(list, options));
  });

  it("falls back to the program when there is nothing to fall back to", () => {
    expect(help({ ...options, prefix: ["nonsense"] })).toBe(helpForProgram(options));
  });
});
