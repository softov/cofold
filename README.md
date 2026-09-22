# cofold

**Declare once. Run it anywhere: a terminal, an agent, a daemon.**

[![license](https://img.shields.io/npm/l/@cofold/commands.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@cofold/commands.svg)](https://www.npmjs.com/package/@cofold/commands)

cofold is one family of TypeScript packages, zero runtime dependencies each, that share a rule: a thing is declared once and every surface is a rendering of that declaration.
For a command, the surfaces are the terminal, MCP, HTTP and a generated reference.
For an agent, the surface is a run: a model proposes, the harness authorizes and executes, a session remembers.
`papo` is the first program on both: the harness in a terminal, as a screen and as a shell.
`cofold` itself, the daemon that composes everything, is not built yet; the name is reserved for it.

## Packages

### Commands

| Package | Purpose |
| --- | --- |
| [`@cofold/sdk`](packages/sdk) | What the packages share: `JsonSchema` and the one validator that holds a value to it, its result, the Standard Schema interface. No dependencies. |
| [`@cofold/commands`](packages/commands) | A command is data: the declaration, the registry, input, the argv grammar, coercion and schema. The whole framework is described here. |
| [`@cofold/terminal`](packages/terminal) | The terminal rendering: argv parsing, help, completion, output modes, exit codes. |
| [`@cofold/mcp`](packages/mcp) | Actions as MCP tools; `./stdio` serves them with no dependencies, `./server` through the official SDK (optional peer). |
| [`@cofold/remote`](packages/remote) | Commands over HTTP: manifests, OpenAPI, authentication, the remote client. |
| [`@cofold/config`](packages/config) | Layered configuration as a capability, each value saying which file set it. |
| [`@cofold/yaml`](packages/yaml) | A documented YAML subset and a document loader with references. |
| [`@cofold/docs`](packages/docs) | Markdown references for people and agents, generated from the declaration. |

### Agents

| Package | Purpose |
| --- | --- |
| [`@cofold/agents`](packages/agents) | The harness: contracts, `createAgent`, `run`, `resume`, tools, capabilities, the step log, the in-memory store, a fake model for tests. |
| [`@cofold/store-file`](packages/store-file) | The durable `Store` on the filesystem: sessions, runs, requests, a writer lease. |
| [`@cofold/tools`](packages/tools) | The tools every agent gets, as capabilities: `files()` today; shell, web, memory next. |
| [`@cofold/model-openai-compat`](packages/model-openai-compat) | Chat Completions adapter (OpenRouter, LM Studio, any compatible server) with a model catalogue and reasoning. |

### Programs

| Package | Purpose |
| --- | --- |
| [`@cofold/papo`](packages/papo) | `papo`: talk to an agent that runs in this process. A screen drawn with [`@textui/chat`](https://github.com/softov/textui) and a shell of `@cofold/commands` actions over the same sessions on disk; `--backend claude` runs both over Claude Code's runtime through its SDK. |

## Try it

```sh
pnpm install
pnpm examples

# one declaration, three surfaces
node examples/commands/dist/petshop/cli.js pet add Rex -a 3 -b corgi
node examples/commands/dist/petshop/cli.js mcp tools

# one turn of an agent, paused for approval, resumed from the store
pnpm --filter cofold-examples-agents run pause-resume

# talk to a model server (LM Studio, Ollama, OpenRouter) from a terminal
PAPO_BASE_URL=http://localhost:1234/v1 node packages/papo/dist/main.js
```

`packages/papo` links `@textui/*` from a sibling `../textui` checkout until textui 0.6.0 is published; `pnpm install` needs it there.

`pnpm check` builds every package, typechecks, and runs the tests.

## Documentation

* [`docs/commands/`](docs/commands/) is the framework manual; start with [Getting started](docs/commands/01-getting-started.md).
* [`docs/agents/`](docs/agents/) is the harness; the spec is [`.project/specs/agent-harness-spec.md`](.project/specs/agent-harness-spec.md).
* [`.project/plans/`](.project/plans/index.md) is what is being built and in which order; [`ROADMAP.md`](ROADMAP.md) holds the framework's open questions.

## License

MIT
