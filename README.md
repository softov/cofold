# softcli

A command is data.


Every CLI library treats a command as *behaviour with a description attached* - `.command().option().action(fn)` - so the declaration is consumed once, by the help printer, and then thrown away. That is why every program eventually hand-writes its MCP tools, its docs, its completion and its `--json` contract again, and why those four drift apart within a month.


Here a command is a plain object that outlives the call. The parser reads it, `--help` reads it, the shell completion reads it, the markdown reference reads it, the agent-facing skill reads it, and the MCP adapter reads it. One statement; six renderings.

```ts
const registry = createRegistry()
  .provide("config", { resolve: () => loadConfig() })
  .provide("store",  { deps: ["config"], resolve: ({ config }) => open(config.path),
                       dispose: (store) => store.flush() });

registry.action({
  id: "note.list",
  summary: "List notes, newest first",
  needs: ["store"],                       // resolved before the handler runs

  input: {
    status: { type: "string", enum: ["open", "done"], description: "Only this status",
              cli: { short: "-s", value: "STATUS" } },
    limit: { type: "integer", minimum: 1, default: 20, description: "How many",
             cli: { short: "-n", value: "N" } },
  },

  surfaces: {                             // presence is the switch
    cli: { pattern: ["note", "list"] },
    http: { method: "GET", path: "/notes" },
    mcp: true,
  },

  run: ({ input, store }) => output(store.all(input.status).slice(0, input.limit)),
});
```

`input` is JSON Schema and it is the only statement of the rules. The terminal parses against it, the MCP tool advertises it, an HTTP request is validated against it, and TypeScript types the handler from it - `input.status` is `"open" | "done" | undefined` and `input.limit` is a `number`. A bound cannot be shown to an agent and go unenforced on a request, because there is one copy of it.

That declaration produces, with nothing else written:

| | |
|---|---|
| `notes note list -s open -n 5` | parsed, coerced, refused with a message if wrong |
| `GET /notes?status=open` | the same action, the same rules, `400` for the same reasons |
| `notes note list --json` / `--quiet` | a stable JSON contract and a bare-identifier contract |
| `notes note list --help` | usage, options, defaults, enum values, what it needs |
| `notes note <TAB>` | completion, with candidates the running program computes |
| `notes docs` / `notes skill` | a markdown reference, and an agent-facing one |
| `note_list` | an MCP tool with a real JSON Schema |

## The entry points

One package, five entry points. They are subpaths rather than separate packages because there is nothing to install differently: an adapter that grows a dependency earns its own package on the day it acquires one, and not before.

| import | what it is |
|---|---|
| [`softcli`](src/core) | the declaration, the capability registry, the canonical input. Knows nothing about terminals. |
| [`softcli/cli`](src/cli) | argv, help, completion, the output contract, exit codes |
| [`softcli/mcp`](src/mcp) | the same registry as MCP tools. No SDK dependency. |
| [`softcli/docs`](src/docs) | the same registry as markdown - for people, and for agents |
| [`softcli/remote`](src/remote) | a command surface that arrives over the wire, or out of an OpenAPI document |
| [`examples/`](examples) | four working programs: `petshop`, `kitchen-sink`, `clerver`, `open-cli` |

Zero runtime dependencies, anywhere. Validation is optional and speaks [Standard Schema](https://standardschema.dev), so zod, valibot and arktype all work and none of them is installed.

## Try it

```sh
npm install && npm run examples

# one declaration on three surfaces
node examples/dist/petshop/cli.js pet add Rex -a 3 -b corgi
node examples/dist/petshop/cli.js mcp tools           # what an agent is shown
node examples/dist/petshop/cli.js serve --port 8799 & # the same rules over HTTP
curl -XPOST localhost:8799/pets -d '{"name":"Ada","age":99}'

# a local CLI
node examples/dist/kitchen-sink/cli.js note add "Ship softcli" -t work
node examples/dist/kitchen-sink/cli.js note list
node examples/dist/kitchen-sink/cli.js skill      # what an agent reads

# a CLI whose commands come from the server
node examples/dist/clerver/cli.js serve --port 8787 &
node examples/dist/clerver/cli.js pet list
node examples/dist/clerver/cli.js pet add Rex --species dog --age 3

# a CLI for an API that never heard of softcli
node examples/dist/open-cli/cli.js \
  --spec examples/samples/petstore.json pet list --limit 2
```

## Documentation

[docs/](docs/) - start with [why](docs/01-why.md), then [getting started](docs/02-getting-started.md).
