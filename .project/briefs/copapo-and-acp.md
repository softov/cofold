---
title: papo becomes copapo, and copapo serves ACP
created: 2026-11-09
refs:
  - git://ee48196 - cofold main, where the facts were checked
  - git://cb74ca9c2 - ahpd main, where the ahpd facts were checked
  - "[code://packages/papo/package.json#L21-L23](../../packages/papo/package.json#L21-L23) - the binary is `papo`"
  - "[code://packages/papo/src/config.ts#L86-L128](../../packages/papo/src/config.ts#L86-L128) - the config names: `papo`, `.papo.json`, `PAPO_*`"
  - "[code://packages/papo/src/types/chat.ts#L127-L203](../../packages/papo/src/types/chat.ts#L127-L203) - `Chat`, the service both backends implement and both fronts use"
  - "[code://.github/workflows/release.yml#L19](../../.github/workflows/release.yml#L19) - papo is not published"
  - "[code://packages/mcp/README.md#L9](../../packages/mcp/README.md#L9) - `@cofold/mcp/stdio` serves over stdio with no dependency"
  - https://agentclientprotocol.com - the Agent Client Protocol, protocol version 1, as `@agentclientprotocol/sdk` 1.8.0 implements it
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-acp/src/presets.ts - the ACP agents ahpd spawns, one row each
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/sdk/src/machines/agents.ts#L92 - `knownAgents`, the name and command of each row
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-cofold/src/config.ts#L42-L107 - agent-cofold reads papo's config names
---

# papo becomes copapo, and copapo serves ACP

Softov wants papo renamed to copapo. He also wants copapo to run as an ACP agent, so that ahpd can run it through agent-acp like the other ACP agents.

## What others do

Each agent that ahpd runs over ACP has a mode of its own CLI: `opencode acp`, `goose acp`, `kilo acp`, `devin acp`, `gemini --acp`, `copilot --acp`. Codex has no ACP mode and runs behind the `codex-acp` adapter. For each agent, ahpd keeps one row with its command and the arguments that start ACP. See [presets.ts](https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-acp/src/presets.ts).

ACP is JSON-RPC 2.0, one message per line, over the agent's stdin and stdout. The client spawns the agent.

## What cofold has today

- `@cofold/papo`, binary `papo` ([package.json](../../packages/papo/package.json#L21-L23)). It is not published ([release.yml](../../.github/workflows/release.yml#L19)). The npm names `@cofold/papo`, `@cofold/copapo` and `copapo` are free.
- papo reads `~/.config/papo/config.json`, the nearest `.papo.json`, `$PAPO_CONFIG` and `--config`, then `PAPO_BASE_URL`, `PAPO_API_KEY`, `PAPO_MODEL` over the family's `COFOLD_*`, and `PAPO_BACKEND` ([config.ts](../../packages/papo/src/config.ts#L86-L128)). `PAPO_WORKSPACE` sets the workspace. `/export` writes `papo-<session>.md`.
- `Chat` is the service that the screen and the shell use. Both backends, cofold and claude, implement it ([types/chat.ts](../../packages/papo/src/types/chat.ts#L127-L203)). It has sessions, settings, models, commands, `say`, `queue`, `wait`, `approve`, `deny`, `answer`, `cancel`, `usage` and `subscribe`.
- `@cofold/mcp/stdio` serves MCP over stdio with no dependency ([README](../../packages/mcp/README.md#L9)). cofold has no ACP code.
- Outside `packages/papo`, about 25 live files name papo. They are `CLAUDE.md`, `README.md`, `ROADMAP.md`, `vitest.workspace.ts`, `release.yml` and `pnpm-lock.yaml`. The `agents` and `tools` READMEs, tests and comments name it too. 111 files under `.project/` name papo. They are records of past work.

## What ahpd has today

- agent-acp calls these agent methods: `initialize`, `authenticate`, `session/new`, `session/load`, `session/list`, `session/resume`, `session/fork`, `session/close`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option`.
- It reads these `session/update` kinds: `agent_message_chunk`, `agent_thought_chunk`, `plan`, `tool_call`, `tool_call_update`, `usage_update`.
- It answers `session/request_permission` and `elicitation/create` (a form, which is a question), and serves `fs/*` and `terminal/*` to the agent.
- A new agent is a row in `knownAgents` ([agents.ts](https://github.com/softov/ahpd/blob/cb74ca9c2/packages/sdk/src/machines/agents.ts#L92)) and a row in `presets` with its arguments and its machine.
- agent-cofold, which runs the cofold harness in ahpd's own process, reads papo's config names: `PAPO_CONFIG`, `~/.config/papo/config.json`, `.papo.json`, `PAPO_*` ([config.ts](https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-cofold/src/config.ts#L42-L107)). The agent-cofold README, `docs/plugins/PLUGINS.md` and `docs/plugins/COMPUTERS.md` name them too, and a machine profile sets `PAPO_CONFIG=/ahpd/cofold/papo/config.json`.

## Who writes

- cofold `main` is the only branch with work. `build/agents/36756252` is merged into it. No fork.
- ahpd changes after a cofold release: agent-cofold moves to the copapo names, and agent-acp gets a copapo row. That is ahpd's own plan, and ahpd's tests run against the cofold release candidate first.

## The change

Answers from Softov, 2026-11-09:

| Question | Answer |
| --- | --- |
| What happens to the config names? | They become copapo's. ahpd's agent-cofold moves to them in its own plan. |
| Where does the ACP server live? | A `copapo acp` command in the copapo package. No new package. |
| Is `@cofold/copapo` published? | Yes, with the next cofold release. |
| Which session methods does the first version serve? | All of them, `session/fork` too. `Chat` gets a `fork` method on both backends. |
| What does copapo do with a `session/prompt` while a turn runs? | It steers the text into the running turn. |
| Does copapo send its slash commands? | Yes, as `available_commands_update`. |

The rename:

- `packages/papo` becomes `packages/copapo`, `@cofold/copapo`, binary `copapo`.
- The config names become `~/.config/copapo/config.json`, `.copapo.json`, `COPAPO_CONFIG`, `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL`, `COPAPO_BACKEND`, `COPAPO_WORKSPACE`. `COFOLD_*` stay. copapo does not read the papo names.
- `/export` writes `copapo-<session>.md`.
- The live files outside the package change with it. The files under `.project/` stay as written.
- The release workflow publishes `@cofold/copapo` with the next release.

ACP:

- `copapo acp` is an ACP agent on stdin and stdout, written in copapo with no dependency, as `@cofold/mcp/stdio` is.
- It maps `Chat`, so both backends run over ACP: `copapo acp` and `copapo --backend claude acp`.
- copapo runs its own tools. It does not use the client's `fs/*` or `terminal/*`.
- A tool call that asks becomes `session/request_permission`, and the answer goes to `approve` or `deny`.
- A question from the agent becomes `elicitation/create`, and the answer goes to `answer`.
- The streamed draft becomes `agent_message_chunk` and `agent_thought_chunk`. Tool calls become `tool_call` and `tool_call_update`. Usage becomes `usage_update`.
- The permission mode is the ACP session mode. The model and the thinking level are session config options.
- It serves `session/new`, `session/prompt`, `session/cancel`, `session/load`, `session/list`, `session/resume`, `session/fork` and `session/close`. The `initialize` answer advertises each one.
- `Chat` gets a `fork` method. The cofold backend calls the store's `sessions.fork` ([types/store.ts](../../packages/agents/src/types/store.ts#L201)). The claude backend calls the SDK's `forkSession`. The fork keeps the session through its last message.
- A `session/prompt` that arrives while a turn runs steers its text into that turn, as `copapo say` to a busy session does. Both prompts get their answer when the turn ends. agent-acp never sends one: it holds a typed message and sends it after the turn ends.
- When a session opens, copapo sends the runtime's commands and the skills as `available_commands_update`. A prompt that starts with `/` runs the command, as `copapo say` does.

## Open points

- After this, ahpd has two ways to run the cofold harness. The agent-cofold plugin runs it in ahpd's own process. The copapo ACP agent runs it in a child process, and also brings copapo's skills, its queue and the claude backend.
- Not checked: the parameters of `session/fork` in ACP, and whether a fork can stop at a message other than the last.
