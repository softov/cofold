import { describe, expect, it } from "vitest";
import { coerce, matchCommand, type Command } from "@facio/commands";
import { globalOptions } from "./globals.js";
import { parse } from "./parse.js";

const commands: Command[] = [
  {
    id: "note.list",
    pattern: ["note", "list"],
    summary: "",
    options: [
      { name: "--limit", short: "-n", value: "N", description: "", coerce: coerce.integer({ min: 1 }) },
      { name: "--tag", short: "-t", value: "TAG", description: "", repeatable: true },
      { name: "--all", short: "-a", description: "" },
      { name: "--wrap", description: "", negatable: true },
    ],
    run: () => {},
  },
  { id: "note.show", pattern: ["note", "show", ":id"], summary: "", run: () => {} },
  { id: "note.rm", pattern: ["note", "rm", ":ids..."], summary: "", run: () => {} },
  {
    id: "report.submit",
    pattern: ["report", "submit", ":case", ":type"],
    summary: "",
    // The same option name as note.list, with a different shape. One flat table
    // across every command could not hold both.
    options: [{ name: "--limit", description: "" }],
    run: () => {},
  },
  { id: "report.show", pattern: ["report", ":id"], summary: "", run: () => {} },
];

const run = (line: string) => parse(commands, globalOptions, line.split(" ").filter(Boolean));

describe("parsing", () => {
  it("reads long options, inline values and repeats", () => {
    const invocation = run("note list --limit=5 --tag a --tag b");
    expect(invocation.command?.id).toBe("note.list");
    expect(invocation.options).toEqual({ "--limit": "5", "--tag": ["a", "b"] });
  });

  it("reads short options, clusters and attached values", () => {
    expect(run("note list -a -n 5").options).toEqual({ "--all": true, "--limit": "5" });
    expect(run("note list -an5").options).toEqual({ "--all": true, "--limit": "5" });
    expect(run("note list -at x").options).toEqual({ "--all": true, "--tag": ["x"] });
  });

  it("negates what is negatable", () => {
    expect(run("note list --no-wrap").options["--wrap"]).toBe(false);
    expect(run("note list --wrap").options["--wrap"]).toBe(true);
  });

  it("leaves a standard global alone rather than shadowing it with a derived negation", () => {
    // `--no-color` is global and explicit; a command's own `--color` must not
    // quietly take the name over.
    expect(run("note list --no-color").options["--no-color"]).toBe(true);
  });

  it("takes a value that begins with a dash when it is not an option this program knows", () => {
    expect(run("note show -5").slots).toEqual({ id: "-5" });
  });

  it("refuses a missing value rather than eating the next option, and names the way out", () => {
    expect(() => run("note list --limit --all")).toThrow(/--limit=VALUE/u);
  });

  it("stops reading options after --", () => {
    const invocation = parse(commands, globalOptions, ["note", "rm", "--", "-a", "--limit"]);
    expect(invocation.slots).toEqual({ ids: ["-a", "--limit"] });
  });

  it("lets two commands declare the same option with different shapes", () => {
    expect(run("note list --limit 5").options["--limit"]).toBe("5");
    expect(run("report submit c1 bug --limit").options["--limit"]).toBe(true);
  });

  it("refuses an option that belongs to another command", () => {
    expect(() => run("note show 1 --limit 5")).toThrow(/Unknown option --limit/u);
  });

  it("suggests the option that was nearly typed", () => {
    expect(() => run("note list --limt 5")).toThrow(/Did you mean "--limit"/u);
  });

  it("prefers a literal word over a slot that would also fit", () => {
    expect(run("report submit c1 bug").command?.id).toBe("report.submit");
    expect(run("report 42").command?.id).toBe("report.show");
  });

  it("requires at least one word for a variadic slot unless it is optional", () => {
    expect(matchCommand(commands, ["note", "rm"])).toBeNull();
    expect(matchCommand(commands, ["note", "rm", "1", "2"])?.slots).toEqual({ ids: ["1", "2"] });
  });

  it("still parses the globals when nothing matched, so --help works half-typed", () => {
    const invocation = run("note --help");
    expect(invocation.command).toBeNull();
    expect(invocation.options["--help"]).toBe(true);
    expect(invocation.words).toEqual(["note"]);
  });
});
