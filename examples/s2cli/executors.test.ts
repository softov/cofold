/**
 * The four executors, and the one property that is not negotiable.
 *
 * `exec` takes argv. A value that reached it came from whoever typed the
 * command, and interpolating that into a shell string is command injection -
 * so the arguments are a list, they are handed to the process as a list, and
 * `shell: true` is the separate thing you have to ask for.
 */

import { describe, expect, it } from "vitest";
import { createRegistry, type Output, type Registry } from "softcli";
import { commandsFromDocument, type ReadOptions } from "./document.js";

function registryOf(document: unknown, options: ReadOptions = {}): Registry<object> {
  let built: Registry<object> | undefined;
  const commands = commandsFromDocument(document, { runner: () => built!, ...options });
  built = createRegistry();
  built.register(...commands);
  return built;
}

async function run(
  registry: Registry<object>,
  id: string,
  input: Record<string, unknown> = {},
): Promise<Output | null> {
  return await registry.execute(registry.find(id)!, { surface: "cli", input });
}

/** A process that prints its own argv, so a test can see exactly what arrived. */
const PRINT_ARGV = ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))"];

describe("noop", () => {
  it("does nothing, and says so when asked to", async () => {
    const registry = registryOf({
      commands: {
        group: { summary: "A word that holds subcommands", run: "noop" },
        spoken: { summary: "Says one line", run: { noop: { message: "nothing to do" } } },
      },
    });
    expect((await run(registry, "group"))?.data).toBeNull();
    expect((await run(registry, "spoken"))?.data).toBe("nothing to do");
  });
});

describe("exec", () => {
  const argvDocument = {
    commands: {
      argv: {
        summary: "Print the arguments as they arrived",
        input: { text: { type: "string" } },
        required: ["text"],
        run: { exec: { command: process.execPath, args: [...PRINT_ARGV, "{text}"] } },
      },
    },
  };

  /*
   * The whole reason `args` is a list. Every one of these is a shell
   * metacharacter, and every one of them has to arrive as literal text.
   */
  it("hands a value to the process as one argument, whatever is in it", async () => {
    const registry = registryOf(argvDocument);
    const hostile = "a; rm -rf /tmp/x && echo pwned | tee $(whoami) `id` > /dev/null";
    const result = await run(registry, "argv", { text: hostile });
    expect(JSON.parse((result?.data as { stdout: string }).stdout)).toEqual([hostile]);
  });

  it("does not let a value become a second argument", async () => {
    const registry = registryOf(argvDocument);
    const result = await run(registry, "argv", { text: "one two three" });
    expect(JSON.parse((result?.data as { stdout: string }).stdout)).toEqual(["one two three"]);
  });

  it("drops an argument a when said no to, and keeps it when it said yes", async () => {
    const registry = registryOf({
      commands: {
        argv: {
          summary: "Print argv",
          input: { force: { type: "boolean", default: false } },
          run: {
            exec: {
              command: process.execPath,
              args: [...PRINT_ARGV, "always", { when: "force", value: "--force" }],
            },
          },
        },
      },
    });
    const without = await run(registry, "argv", { force: false });
    expect(JSON.parse((without?.data as { stdout: string }).stdout)).toEqual(["always"]);
    const with_ = await run(registry, "argv", { force: true });
    expect(JSON.parse((with_?.data as { stdout: string }).stdout)).toEqual(["always", "--force"]);
  });

  it("expands a list into one argument per item", async () => {
    const registry = registryOf({
      commands: {
        argv: {
          summary: "Print argv",
          input: { tags: { type: "array", items: { type: "string" }, default: [] } },
          run: {
            exec: {
              command: process.execPath,
              args: [...PRINT_ARGV, { each: "tags", value: "tag={$item}" }],
            },
          },
        },
      },
    });
    const result = await run(registry, "argv", { tags: ["a", "b"] });
    expect(JSON.parse((result?.data as { stdout: string }).stdout)).toEqual(["tag=a", "tag=b"]);
  });

  /*
   * A bare `{env}` is an input field even when the command has one called
   * `env`, which every deploy command does. The environment is reached through
   * a dot, and an input field never has one.
   */
  it("reads a bare name as an input field and a dotted one as the environment", async () => {
    const registry = registryOf({
      commands: {
        argv: {
          summary: "Print argv",
          input: { env: { type: "string", default: "production" } },
          run: {
            exec: {
              command: process.execPath,
              args: [...PRINT_ARGV, "{env}", "{$env.RELEASE_CHANNEL}"],
            },
          },
        },
      },
    }, { environment: { RELEASE_CHANNEL: "stable" } });
    const result = await run(registry, "argv", { env: "staging" });
    expect(JSON.parse((result?.data as { stdout: string }).stdout)).toEqual(["staging", "stable"]);
  });

  it("gives the process the environment the document loaded", async () => {
    const registry = registryOf({
      commands: {
        argv: {
          summary: "Print an environment variable",
          run: {
            exec: {
              command: process.execPath,
              args: ["-e", "process.stdout.write(String(process.env.RELEASE_CHANNEL))"],
            },
          },
        },
      },
    }, { environment: { RELEASE_CHANNEL: "stable" } });
    expect((await run(registry, "argv"))?.data).toMatchObject({ stdout: "stable" });
  });

  it("stops the batch at the first failure", async () => {
    const registry = registryOf({
      commands: {
        two: {
          summary: "One step that fails, one that would not",
          run: [
            { exec: { command: process.execPath, args: ["-e", "process.exit(3)"] } },
            { exec: { command: process.execPath, args: ["-e", "process.stdout.write('reached')"] } },
          ],
        },
      },
    });
    await expect(run(registry, "two")).rejects.toThrow("exited with 3");
  });

  it("says so when the command is not there at all", async () => {
    const registry = registryOf({
      commands: { gone: { summary: "Missing", run: { exec: { command: "./no-such-program" } } } },
    });
    await expect(run(registry, "gone")).rejects.toThrow("could not be run");
  });
});

/**
 * The escape hatch, and the contrast that shows why it is one.
 *
 * The same text that arrived as one literal argument above is interpreted here,
 * which is exactly what `shell: true` buys and exactly why it is not the
 * default.
 */
describe("shell: true", () => {
  it("runs a command line, quoting and all", async () => {
    const registry = registryOf({
      commands: {
        pipeline: {
          summary: "A command line",
          run: { exec: { command: "echo $(echo interpolated) | tr a-z A-Z", shell: true } },
        },
      },
    });
    expect((await run(registry, "pipeline"))?.data).toMatchObject({ stdout: "INTERPOLATED\n" });
  });
});

describe("rest", () => {
  interface Seen { url: string; method: string; body: string | undefined; headers: Headers }

  const stub = (seen: Seen[], answer: unknown = { ok: true }): typeof globalThis.fetch =>
    (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response> => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : String(init.body),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

  const document = {
    config: { api: "http://127.0.0.1:9/api" },
    commands: {
      "pet.add": {
        summary: "Add a pet",
        input: {
          name: { type: "string", minLength: 1 },
          age: { type: "integer", minimum: 0 },
          trace: { type: "string", default: "on" },
        },
        required: ["name"],
        run: {
          rest: {
            method: "POST",
            endpoint: "{$config.api}/pets",
            headers: { "x-trace": "{trace}" },
            query: { source: "s2cli" },
            body: { name: "{name}", age: { when: "age", value: "{age}" } },
          },
        },
      },
    },
  };

  it("sends the method, the URL, the query and the body the document stated", async () => {
    const seen: Seen[] = [];
    const registry = registryOf(document, { fetch: stub(seen) });
    const result = await run(registry, "pet.add", { name: "Ada", age: 4, trace: "on" });

    expect(result?.data).toEqual({ ok: true });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("http://127.0.0.1:9/api/pets?source=s2cli");
    expect(JSON.parse(seen[0]!.body!)).toEqual({ name: "Ada", age: 4 });
    expect(seen[0]?.headers.get("x-trace")).toBe("on");
  });

  it("leaves out a body field that nothing gave a value", async () => {
    const seen: Seen[] = [];
    const registry = registryOf(document, { fetch: stub(seen) });
    await run(registry, "pet.add", { name: "Ada", trace: "on" });
    expect(JSON.parse(seen[0]!.body!)).toEqual({ name: "Ada" });
  });

  it("answers a refusal the way every other remote command does", async () => {
    const failing = (async () => new Response(JSON.stringify({ message: "no" }), { status: 409 })) as typeof globalThis.fetch;
    const registry = registryOf(document, { fetch: failing });
    await expect(run(registry, "pet.add", { name: "Ada", trace: "on" })).rejects.toThrow("no");
  });
});

describe("internal", () => {
  const document = {
    commands: {
      say: {
        summary: "Say it back",
        input: { text: { type: "string", minLength: 1, maxLength: 5 } },
        required: ["text"],
        run: { noop: { message: "said" } },
      },
      relay: {
        summary: "Say it through another command",
        input: { text: { type: "string" } },
        required: ["text"],
        run: { internal: { command: "say", input: { text: "{text}" } } },
      },
    },
  };

  it("runs the other command through the same front door", async () => {
    const registry = registryOf(document);
    expect((await run(registry, "relay", { text: "hi" }))?.data).toBe("said");
  });

  /*
   * The point of going through `execute`: the target's own schema applies. A
   * command called from a document is not a command with the checks turned off.
   */
  it("holds the target to its own schema", async () => {
    const registry = registryOf(document);
    await expect(run(registry, "relay", { text: "far too long" }))
      .rejects.toThrow("must be 1 to 5 characters");
  });

  it("answers with the list when a command has several steps", async () => {
    const registry = registryOf({
      commands: {
        both: {
          summary: "Two steps",
          run: [{ noop: { message: "one" } }, { noop: { message: "two" } }],
        },
      },
    });
    expect((await run(registry, "both"))?.data).toEqual(["one", "two"]);
  });
});

/**
 * What a placeholder may reach.
 *
 * One rule: `$` means "not an input field". Everything without it is the
 * input, all the way down, which is what lets a command have a field called
 * `env` and still read the environment.
 */
describe("interpolation", () => {
  const document = {
    config: { theme: { mode: "dark" } },
    commands: {
      argv: {
        summary: "Print argv",
        input: {
          env: { type: "string", default: "production" },
          theme: {
            type: "object",
            properties: { mode: { type: "string" }, color: { type: "string" } },
          },
        },
        run: {
          exec: {
            command: process.execPath,
            args: [
              ...PRINT_ARGV,
              "{env}",
              "{theme.mode}",
              "{$env.RELEASE_CHANNEL}",
              "{$config.theme.mode}",
            ],
          },
        },
      },
    },
  };

  it("reads a bare name as an input field and a dotted one as a subpath of it", async () => {
    const registry = registryOf(document, { environment: { RELEASE_CHANNEL: "stable" } });
    const result = await run(registry, "argv", { env: "staging", theme: { mode: "light" } });
    expect(JSON.parse((result?.data as { stdout: string }).stdout))
      .toEqual(["staging", "light", "stable", "dark"]);
  });

  it("faults by name when nothing gave a placeholder a value", async () => {
    const registry = registryOf(document, { environment: {} });
    await expect(run(registry, "argv", { env: "staging", theme: { mode: "light" } }))
      .rejects.toThrow("needs {$env.RELEASE_CHANNEL}");
  });

  it("walks into the item of an each", async () => {
    const registry = registryOf({
      commands: {
        argv: {
          summary: "Print argv",
          input: {
            pets: {
              type: "array",
              items: { type: "object", properties: { name: { type: "string" } } },
              default: [],
            },
          },
          run: {
            exec: {
              command: process.execPath,
              args: [...PRINT_ARGV, { each: "pets", value: "name={$item.name}" }],
            },
          },
        },
      },
    });
    const result = await run(registry, "argv", { pets: [{ name: "Ada" }, { name: "Byte" }] });
    expect(JSON.parse((result?.data as { stdout: string }).stdout)).toEqual(["name=Ada", "name=Byte"]);
  });
});
