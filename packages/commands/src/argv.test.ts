import type { Command } from "./types/command.js";
import type { OptionSpec } from "./types/field.js";
import { describe, expect, it } from "vitest";
import { matchCommand, optionTable, tokenize } from "./argv.js";

const options: OptionSpec[] = [
  { name: "--limit", short: "-n", value: "N", description: "" },
  { name: "--tag", short: "-t", value: "TAG", description: "", repeatable: true },
  { name: "--all", short: "-a", description: "" },
  { name: "--wrap", description: "", negatable: true },
  { name: "--no-color", description: "" },
];

const read = (line: string, permissive = false) =>
  tokenize(optionTable(options, permissive), line.split(" ").filter(Boolean), { permissive });

describe("the option table", () => {
  it("answers to a long name, a short alias and a derived negation", () => {
    const table = optionTable(options);
    expect(table.get("--limit")?.spec.name).toBe("--limit");
    expect(table.get("-n")?.spec.name).toBe("--limit");
    expect(table.get("--no-wrap")).toEqual({ spec: table.get("--wrap")!.spec, negated: true });
  });

  it("gives a --no- option the positive form as its negation", () => {
    expect(optionTable(options).get("--color")).toEqual({
      spec: options[4],
      negated: true,
    });
  });

  it("prefers the shape that takes a value when two commands disagree about a name", () => {
    // The permissive table is a union across commands, and a value mistaken for
    // a word is the failure that loses the command; a word mistaken for a value
    // is recoverable by the strict pass.
    const union: OptionSpec[] = [
      { name: "--limit", value: "N", description: "" },
      { name: "--limit", description: "" },
    ];
    expect(optionTable(union, true).get("--limit")?.spec.value).toBe("N");
    expect(optionTable(union).get("--limit")?.spec.value).toBeUndefined();
  });
});

describe("tokenizing a line of arguments", () => {
  it("separates words from options", () => {
    const tokens = read("note list --all extra");
    expect(tokens.words).toEqual(["note", "list", "extra"]);
    expect(tokens.options).toEqual({ "--all": true });
  });

  it("reads a value inline or as the next argument, and collects what repeats", () => {
    expect(read("--limit=5").options).toEqual({ "--limit": "5" });
    expect(read("--limit 5").options).toEqual({ "--limit": "5" });
    expect(read("--tag a --tag b").options).toEqual({ "--tag": ["a", "b"] });
  });

  it("expands a short cluster and lets its last letter take the value", () => {
    expect(read("-a -n 5").options).toEqual({ "--all": true, "--limit": "5" });
    expect(read("-an5").options).toEqual({ "--all": true, "--limit": "5" });
    expect(read("-at x").options).toEqual({ "--all": true, "--tag": ["x"] });
  });

  it("records a negation as false and the plain form as true", () => {
    expect(read("--no-wrap").options["--wrap"]).toBe(false);
    expect(read("--wrap").options["--wrap"]).toBe(true);
  });

  it("keeps everything after -- as words, untouched", () => {
    const tokens = tokenize(optionTable(options), ["rm", "--", "-a", "--limit"], { permissive: false });
    expect(tokens.passthrough).toEqual(["-a", "--limit"]);
    expect(tokens.words).toEqual(["rm", "-a", "--limit"]);
  });

  it("takes a dash value that is not an option this program knows", () => {
    expect(read("--tag -5").options).toEqual({ "--tag": ["-5"] });
    expect(read("show -5").words).toEqual(["show", "-5"]);
  });

  it("refuses a value that is a known option, and names the way out", () => {
    expect(() => read("--limit --all")).toThrow(/--limit=VALUE/u);
  });

  it("refuses an unknown option and suggests the one nearly typed", () => {
    expect(() => read("--limt 5")).toThrow(/Unknown option --limt\. Did you mean "--limit"/u);
    expect(() => read("-x")).toThrow(/Unknown option -x/u);
  });

  it("refuses a value given to a flag", () => {
    expect(() => read("--all=yes")).toThrow(/does not take a value/u);
  });
});

describe("tokenizing permissively", () => {
  it("keeps an unknown option rather than throwing, so the words stay findable", () => {
    const tokens = read("note list --limt 5", true);
    expect(tokens.unknown).toEqual(["--limt"]);
    expect(tokens.words).toEqual(["note", "list", "5"]);
  });

  it("assumes a flag when a value is missing, and leaves the refusal to the strict pass", () => {
    expect(read("note --limit", true).options["--limit"]).toBe(true);
    expect(() => read("note --limit")).toThrow(/requires N/u);
  });
});

const commands: Command[] = [
  { id: "note.show", pattern: ["note", "show", ":id"], summary: "", run: () => {} },
  { id: "note.rm", pattern: ["note", "rm", ":ids..."], summary: "", run: () => {} },
  { id: "note.tail", pattern: ["note", "tail", ":ids...?"], summary: "", run: () => {} },
  { id: "report.submit", pattern: ["report", "submit", ":case", ":type"], summary: "", run: () => {} },
  { id: "report.show", pattern: ["report", ":id"], summary: "", run: () => {} },
];

describe("matching words to a command", () => {
  it("scores a literal above a slot that would also fit", () => {
    expect(matchCommand(commands, ["report", "submit", "c1", "bug"])?.command.id).toBe("report.submit");
    expect(matchCommand(commands, ["report", "42"])?.command.id).toBe("report.show");
  });

  it("fills slots, and a variadic slot with the rest", () => {
    expect(matchCommand(commands, ["note", "show", "7"])?.slots).toEqual({ id: "7" });
    expect(matchCommand(commands, ["note", "rm", "1", "2"])?.slots).toEqual({ ids: ["1", "2"] });
  });

  it("requires a word for a variadic slot unless it is optional", () => {
    expect(matchCommand(commands, ["note", "rm"])).toBeNull();
    expect(matchCommand(commands, ["note", "tail"])?.slots).toEqual({});
  });

  it("answers null when the words are no command, spare or short", () => {
    expect(matchCommand(commands, ["note", "show", "7", "extra"])).toBeNull();
    expect(matchCommand(commands, ["note"])).toBeNull();
  });
});
