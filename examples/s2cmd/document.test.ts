/**
 * Everything a document can get wrong, said at registration.
 *
 * The rule this file holds the reader to: if it can be known without running
 * anything, it is a crash on the first run of the binary rather than a surprise
 * on the one command nobody tested. A document is a configuration file, so the
 * person who broke it is not the person who wrote the program.
 */

import { describe, expect, it } from "vitest";
import { createRegistry, type Registry } from "facio";
import { commandsFromDocument, type ReadOptions } from "./document.js";
import { parseYaml } from "./yaml.js";

function read(text: string, options: ReadOptions = {}): ReturnType<typeof commandsFromDocument> {
  return commandsFromDocument(parseYaml(text), options);
}

function registryOf(text: string, options: ReadOptions = {}): Registry<object> {
  let built: Registry<object> | undefined;
  const commands = read(text, { runner: () => built!, ...options });
  built = createRegistry();
  built.register(...commands);
  return built;
}

const ECHO = [
  "commands:",
  "  echo:",
  "    summary: Say it back",
  "    input:",
  "      text: { type: string, minLength: 1 }",
  "    required: [text]",
  "    surfaces:",
  "      cli: { pattern: [echo, \":text\"] }",
  "    run:",
  "      noop: { message: said }",
].join("\n");

describe("what a document becomes", () => {
  it("produces the command every surface already knows how to render", () => {
    const [command] = read(ECHO);
    expect(command?.id).toBe("echo");
    expect(command?.pattern).toEqual(["echo", ":text"]);
    expect(command?.arguments?.["text"]?.coerce?.schema).toEqual({ type: "string", minLength: 1 });
  });

  it("spells a command line from the id when the document does not", () => {
    const [command] = read("commands:\n  pet.list:\n    summary: List\n    run: noop\n");
    expect(command?.pattern).toEqual(["pet", "list"]);
  });

  it("takes a single step unwrapped, and a bare executor name", () => {
    expect(() => read("commands:\n  a:\n    summary: A\n    run: noop\n")).not.toThrow();
    expect(() => read("commands:\n  a:\n    summary: A\n    run:\n      noop: {}\n")).not.toThrow();
  });

  it("carries the terminal spelling without letting it into the schema", () => {
    const [command] = read([
      "commands:",
      "  a:",
      "    summary: A",
      "    input:",
      "      dryRun: { type: boolean, default: false, cli: { short: -n } }",
      "    run: noop",
    ].join("\n"));
    const option = command?.options?.[0];
    expect(option?.name).toBe("--dry-run");
    expect(option?.short).toBe("-n");
    expect(option?.coerce?.schema).toEqual({ type: "boolean", default: false });
  });
});

describe("the shapes it refuses", () => {
  const refuses = (text: string, message: string, options: ReadOptions = {}): void => {
    expect(() => read(text, options)).toThrow(message);
  };

  it("refuses a key it does not read, rather than ignoring it", () => {
    refuses("commands:\n  a:\n    summary: A\n    run: noop\n    colour: red\n", "a has no colour");
    refuses("nmae: x\ncommands:\n  a:\n    summary: A\n    run: noop\n", "the document has no nmae");
  });

  it("refuses a schema keyword it does not enforce", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    input:\n      n: { type: string, maxlength: 3 }\n    run: noop\n",
      "a.input.n has no maxlength",
    );
    refuses(
      "commands:\n  a:\n    summary: A\n    input:\n      n: { anyOf: [] }\n    run: noop\n",
      "a.input.n has no anyOf",
    );
  });

  it("refuses an unknown executor, with the ones it has", () => {
    refuses("commands:\n  a:\n    summary: A\n    run:\n      shellout: {}\n", "exec, internal, noop, rest");
  });

  it("refuses a step naming two executors", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: x }\n      rest: { method: GET, endpoint: 'http://h/' }\n",
      "one step is one executor",
    );
  });

  it("refuses required naming a field that is not declared", () => {
    refuses("commands:\n  a:\n    summary: A\n    required: [ghost]\n    run: noop\n", "which is not an input field");
  });

  it("refuses a pattern naming a field that is not declared", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    surfaces:\n      cli: { pattern: [a, \":ghost\"] }\n    run: noop\n",
      "which is not an input field",
    );
  });

  it("refuses a placeholder naming nothing, and says what there is", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    input:\n      env: { type: string }\n    run:\n      exec: { command: ./x, args: [\"{envv}\"] }\n",
      "is not an input field of this command (it has env)",
    );
  });

  it("refuses a namespace this program does not have", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: ./x, args: [\"{$secrets.token}\"] }\n",
      "$secrets is not a name this program knows, and it has $env, $config, $item",
    );
  });

  it("refuses a namespace with no path into it", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: ./x, args: [\"{$env}\"] }\n",
      "it needs a path into it, as $env.something",
    );
  });

  it("refuses {$item} outside an each", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: ./x, args: [\"{$item}\"] }\n",
      "$item is only in scope inside an each",
    );
  });

  it("refuses args written as a command line", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: ./x, args: \"one two\" }\n",
      "must be a list",
    );
  });

  it("refuses a condition where there is nothing to drop", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    input:\n      f: { type: boolean, default: false }\n    run:\n      exec: { command: { when: f, value: ./x } }\n",
      "a lone value has nothing to drop it from",
    );
  });

  it("refuses each outside a list, because only a list can hold a repeat", () => {
    refuses([
      "commands:",
      "  a:",
      "    summary: A",
      "    input:",
      "      tags: { type: array, items: { type: string }, default: [] }",
      "    run:",
      "      rest:",
      "        method: POST",
      "        endpoint: http://h/x",
      "        body: { tag: { each: tags, value: \"{$item}\" } }",
    ].join("\n"), "which repeats a value, so it belongs in a list");
  });

  it("refuses a shell step that also lists arguments", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      exec: { command: 'echo hi', shell: true, args: [x] }\n",
      "put the arguments in command",
    );
  });

  it("refuses a rest step that is not a URL, and a method it cannot send", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      rest: { method: GET, endpoint: /pets }\n",
      "endpoint is an absolute URL",
    );
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      rest: { method: TRACE, endpoint: 'http://h/' }\n",
      "method is one of",
    );
  });

  it("refuses an internal step calling a command the document does not declare", () => {
    refuses(
      "commands:\n  a:\n    summary: A\n    run:\n      internal: { command: b }\n",
      "which this document does not declare",
    );
  });

  it("refuses internal steps that call each other in a circle", () => {
    refuses([
      "commands:",
      "  a:",
      "    summary: A",
      "    run:",
      "      internal: { command: b }",
      "  b:",
      "    summary: B",
      "    run:",
      "      internal: { command: a }",
    ].join("\n"), "a -> b -> a call each other");
  });

  it("refuses imports and env, which the loader resolves before this", () => {
    refuses("imports: [other.yaml]\ncommands:\n  a:\n    summary: A\n    run: noop\n", "resolved when the document is loaded");
  });

  it("refuses a document with no commands", () => {
    refuses("name: x\n", "declares no commands");
  });
});

/**
 * The rule this front end exists for.
 *
 * A document is a file anybody can edit. If MCP came for free then one more
 * line in it would hand an agent arbitrary shell, so a command that runs a
 * process refuses to be published as a tool or a route unless it says so - and
 * refuses loudly, because a surface that is silently missing is a surface
 * somebody spends an afternoon debugging.
 */
describe("a process is not published by accident", () => {
  const command = (surfaces: string, extra = ""): string => [
    "commands:",
    "  deploy:",
    "    summary: Deploy",
    `    surfaces:${surfaces}`,
    extra,
    "    run:",
    "      exec: { command: ./scripts/deploy.sh }",
  ].filter((line) => line !== "").join("\n");

  it("refuses an exec command published as an MCP tool", () => {
    expect(() => read(command("\n      cli: { pattern: [deploy] }\n      mcp: true")))
      .toThrow("deploy runs exec and is published as an MCP tool");
  });

  it("refuses an exec command published as an HTTP route", () => {
    expect(() => read(command("\n      http: { method: POST, path: /deploy }")))
      .toThrow("deploy runs exec and is published as an HTTP route");
  });

  it("names both surfaces when both were asked for", () => {
    expect(() => read(command("\n      http: { method: POST, path: /deploy }\n      mcp: true")))
      .toThrow("an MCP tool and an HTTP route");
  });

  it("points at the opt-in, which is not part of surfaces", () => {
    expect(() => read(command("\n      mcp: true"))).toThrow("Write allowRemoteExec: true on deploy");
  });

  it("publishes it once the command opts in explicitly", () => {
    const commands = read(command("\n      cli: { pattern: [deploy] }\n      mcp: true", "    allowRemoteExec: true"));
    expect(commands[0]?.surfaces?.mcp).toBe(true);
  });

  it("leaves a command that runs no process alone", () => {
    const commands = read([
      "commands:",
      "  ping:",
      "    summary: Ping",
      "    surfaces:",
      "      mcp: true",
      "      http: { method: GET, path: /ping }",
      "    run:",
      "      rest: { method: GET, endpoint: 'http://127.0.0.1:1/ping' }",
    ].join("\n"));
    expect(commands[0]?.surfaces?.mcp).toBe(true);
  });

  /*
   * The unsafety travels: a command whose only step calls another command that
   * runs a process is a command that runs a process, and publishing it would
   * hand over the same thing one indirection away.
   */
  it("refuses a command that reaches a process through an internal step", () => {
    expect(() => read([
      "commands:",
      "  ship:",
      "    summary: Ship",
      "    surfaces:",
      "      mcp: true",
      "    run:",
      "      internal: { command: deploy }",
      "  deploy:",
      "    summary: Deploy",
      "    run:",
      "      exec: { command: ./scripts/deploy.sh }",
    ].join("\n"))).toThrow("ship runs exec in deploy and is published as an MCP tool");
  });
});

describe("the registry it registers into", () => {
  it("registers, verifies and runs", async () => {
    const registry = registryOf(ECHO);
    registry.verify();
    const command = registry.find("echo")!;
    const result = await registry.execute(command, { surface: "cli", input: { text: "hi" } });
    expect(result?.data).toBe("said");
  });
});
