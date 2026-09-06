# Getting started

```sh
npm add softcli
```

## A program

```ts
#!/usr/bin/env node
import { coerce, createRegistry, output } from "softcli";
import { Program, runEntry } from "softcli/cli";

const registry = createRegistry();

const greet = registry.command({
  id: "greet",
  pattern: ["greet", ":name"],
  summary: "Say hello",
  arguments: { name: { description: "Who to greet" } },
  options: [
    { name: "--times", short: "-n", value: "N", description: "How many times",
      coerce: coerce.integer({ min: 1 }), default: 1 },
    { name: "--shout", description: "In capitals" },
  ],
  run: (context) => {
    const line = `Hello, ${context.value("name")}!`;
    const said = Array.from({ length: context.value<number>("times") },
      () => (context.flag("shout") ? line.toUpperCase() : line));
    return output(said, `${said.join("\n")}\n`);
  },
});

registry.register(greet);

const program = new Program({ name: "hello", version: "1.0.0", registry });
await runEntry(program, process.argv.slice(2));
```

That is a complete program. It already has `--help`, `--version`, `--json`, `--quiet`, `--no-color`, `hello completion bash`, an exit-code taxonomy, and a refusal for `-n 0` that names the option the way you typed it.

## The three parts

**The registry** holds the commands and the capabilities they can ask for. `createRegistry({ groups })` additionally makes `group` mandatory, which is worth turning on the moment you generate documentation.

**A command** is the object above. `pattern` is the words, with `:name` for a slot (`:name?` optional, `:name...` one or more). `options` are the flags. `run` receives a context whose `input` is everything already parsed, coerced and validated.

**The program** is the terminal in front of the registry: argv in, one of three output shapes out. Nothing about your commands is in it, which is why a test can build a program over a two-command registry and drive exactly the code path the binary does.

## Growing it

- Something the command needs before it runs - a config file, a database, an authenticated client? That is a [capability](04-capabilities.md).
- Want the command to be an MCP tool as well? `surfaces: { mcp: true }`, and see [MCP](07-mcp.md).
- Want a reference document that cannot go stale? [Generated docs](08-generated-docs.md).

The whole surface, exercised, is [`examples/kitchen-sink`](../examples/kitchen-sink/cli.ts) - about 250 lines for ten commands, two capabilities, dynamic completion, piped input and two generated documents.
