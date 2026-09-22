# Getting started

```sh
npm add doopx
```

## A program

```ts
#!/usr/bin/env node
import { createRegistry, output } from "@doopx/commands";
import { Program, runEntry } from "@doopx/terminal";

const registry = createRegistry();

registry.action({
  id: "greet",
  summary: "Say hello",
  input: {
    name: { type: "string", description: "Who to greet" },
    times: { type: "integer", minimum: 1, default: 1, description: "How many times",
             cli: { short: "-n", value: "N" } },
    shout: { type: "boolean", description: "In capitals" },
  },
  required: ["name"],
  surfaces: { cli: { pattern: ["greet", ":name"] } },
  run: ({ input }) => {
    const line = `Hello, ${input.name}!`;
    const said = Array.from({ length: input.times }, () => (input.shout === true ? line.toUpperCase() : line));
    return output(said, `${said.join("\n")}\n`);
  },
});

const program = new Program({ name: "hello", version: "1.0.0", registry });
await runEntry(program, process.argv.slice(2));
```

That is a complete program. It already has `--help`, `--version`, `--json`, `--quiet`, `--no-color`, `hello completion bash`, an exit-code taxonomy, and a refusal for `-n 0` that names the option the way you typed it. `input.name` is a `string` and `input.times` is a `number`, because the schemas that validate them are also the ones TypeScript reads.

## The three parts

**The registry** holds the commands and the capabilities they can ask for. `createRegistry({ groups })` additionally makes `group` mandatory, which is worth turning on the moment you generate documentation.

**An action** is the object above. `input` is what it takes, as JSON Schema, and it is the only statement of the rules. `surfaces` is where it can be reached from: `cli` gives the words, with `:name` for a slot (`:name?` optional, `:name...` one or more), and every field the pattern does not name becomes an option. `run` receives a context whose `input` is everything already parsed, coerced and validated.

**The program** is the terminal in front of the registry: argv in, one of three output shapes out. Nothing about your commands is in it, which is why a test can build a program over a two-command registry and drive exactly the code path the binary does.

## Growing it

- Something the action needs before it runs - a config file, a database, an authenticated client? That is a [capability](04-capabilities.md).
- Want it to be an MCP tool as well? `surfaces: { mcp: true }`, and see [MCP](07-mcp.md).
- Want it to answer over HTTP too? `surfaces: { http: { method, path } }`, and see [Remote](09-remote.md).
- Want a reference document that cannot go stale? [Generated docs](08-generated-docs.md).
- Wondering where a rule is actually enforced? [Validation](03-validation.md).

One declaration on three surfaces at once is [`examples/petshop`](../../examples/commands/petshop/cli.ts): the same actions typed at a terminal, printed as MCP tools, and served over HTTP by `petshop serve`.

The whole surface, exercised, is [`examples/kitchen-sink`](../../examples/commands/kitchen-sink/cli.ts) - about 250 lines for ten commands, two capabilities, dynamic completion, piped input and two generated documents.
