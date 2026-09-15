# facio

**Declare once. Run it anywhere: a terminal, an agent, a daemon.**

[![license](https://img.shields.io/npm/l/@facio/commands.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@facio/commands.svg)](https://www.npmjs.com/package/@facio/commands)

facio is one family of TypeScript packages, zero runtime dependencies each, that share a rule: a thing is declared once and every surface is a rendering of that declaration.
For a command, the surfaces are the terminal, MCP, HTTP and a generated reference.
For an agent, the surface is a run: a model proposes, the harness authorizes and executes, a session remembers.
`facio` itself, the program that composes the two, is not built yet; the name is reserved for it.

## Packages

### Commands

| Package | Purpose |
| --- | --- |
| [`@facio/sdk`](packages/sdk) | What the packages share: `JsonSchema` and the one validator that holds a value to it, its result, the Standard Schema interface. No dependencies. |
| [`@facio/commands`](packages/commands) | A command is data: the declaration, the registry, input, the argv grammar, coercion and schema. The whole framework is described here. |
| [`@facio/terminal`](packages/terminal) | The terminal rendering: argv parsing, help, completion, output modes, exit codes. |
| [`@facio/mcp`](packages/mcp) | Actions as MCP tools; `./stdio` serves them with no dependencies, `./server` through the official SDK (optional peer). |
| [`@facio/remote`](packages/remote) | Commands over HTTP: manifests, OpenAPI, authentication, the remote client. |
| [`@facio/config`](packages/config) | Layered configuration as a capability, each value saying which file set it. |
| [`@facio/yaml`](packages/yaml) | A documented YAML subset and a document loader with references. |
| [`@facio/docs`](packages/docs) | Markdown references for people and agents, generated from the declaration. |

### Agents

| Package | Purpose |
| --- | --- |
| [`@facio/agents`](packages/agents) | The harness: contracts, `createAgent`, `run`, `resume`, tools, capabilities, the step log, the in-memory store, a fake model for tests. |
| [`@facio/store-file`](packages/store-file) | The durable `Store` on the filesystem: sessions, runs, requests, a writer lease. |
| [`@facio/model-openai-compat`](packages/model-openai-compat) | Chat Completions adapter (OpenRouter, LM Studio, any compatible server) with a model catalogue and reasoning. |

## Try it

```sh
pnpm install
pnpm examples

# one declaration, three surfaces
node examples/commands/dist/petshop/cli.js pet add Rex -a 3 -b corgi
node examples/commands/dist/petshop/cli.js mcp tools

# one turn of an agent, paused for approval, resumed from the store
pnpm --filter facio-examples-agents run pause-resume
```

`pnpm check` builds every package, typechecks, and runs the tests.

## Documentation

* [`docs/commands/`](docs/commands/) is the framework manual; start with [Getting started](docs/commands/01-getting-started.md).
* [`docs/agents/`](docs/agents/) is the harness; the spec is [`roadmap/specs/agent-harness-spec.md`](roadmap/specs/agent-harness-spec.md).
* [`roadmap/plans/`](roadmap/plans/index.md) is what is being built and in which order; [`ROADMAP.md`](ROADMAP.md) holds the framework's open questions.

## License

MIT
