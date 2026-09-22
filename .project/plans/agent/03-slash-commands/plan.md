---
title: AGENT-03 - Slash commands: internal ones the runtime lists and runs, external ones the client keeps
domain: agent
status: planned
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core-p5-streaming-context-usage/plan.md
  - plans/cli/02-papo-commands/plan.md
  - plans/cli/03-papo-claude/plan.md
refs:
  - code://packages/agents/src/run/run.ts#L29-L58 - `run()` and `compact()` both go through `start(args, compacting)`; `compact()` is a run whose input is the ask (`source: 'system'`) and whose one step writes the `summary` message
  - code://packages/agents/src/run/context.ts#L46 - `contextOf(history)`: the newest `summary` first, then every message no summary covers. Nothing else is filtered by `source`
  - code://packages/agents/src/types/message.ts#L34 - `MessageSource = 'input' | 'model' | 'tool' | 'hook' | 'summary' | 'system'`
  - code://packages/agents/src/types/command.ts - `RunCommand` is `approve | deny | answer | cancel` (steer planned): the handle's control commands. The name "command" is taken by that; the new concept is a *slash command*
  - code://packages/agents/src/types/capability.ts#L18-L30 - a `Capability` contributes `tools()` and `instructions()`; the shape a slash-command contribution mirrors
  - code://packages/agents/src/capabilities/skills.ts - `listSkills(sources)` and the prompt rule "send `/<name>`"; a skill is a prompt the model reads, not a command the runtime runs
  - code://packages/papo/src/chat.ts#L88-L96 - papo keeps `Settings { model, permissions, reasoning, autoCompact }` per session in `kv` and rebuilds the `Agent` from them for every turn (`agentFor`)
  - code://packages/papo/src/agent.ts - `buildAgent`: the definition papo hands the harness (instructions, capabilities, policy, skills, context); the one place papo can register commands the runtime runs
  - code://packages/papo/src/screen/app.tsx#L367-L505 - the client commands: `app.*`, `session.*`, `view.*`, `chat.*`; the `/` list is `skills + app.commands.list({ slot: 'palette' })` (chat.tsx:17-26)
  - code://packages/papo/src/screen/chat.tsx#L132-L139 - a picked skill becomes the draft `/<name> `; a picked client command runs through `app.execute`
  - code://packages/papo/src/turns.ts#L46-L47 - `source: 'input' | 'system'` is a turn's input; `summary` a summary part; `notice` parts exist (used by the Claude projection for `<local-command-stdout>`)
  - code://packages/papo/src/claude/project.ts#L10-L11 - Claude's transcript after a command: a user message `<command-name>/compact</command-name>...` (the echo) and a user message `<local-command-stdout>Compacted </local-command-stdout>` (the output); projected as input `/compact` + notice `Compacted`
  - code://packages/agents/src/run/compact.ts - the compaction step; `/compact` calls it
  - code://packages/agents/src/capabilities/skills.ts:listSkills - the shape of `listSlashCommands`
  - code://packages/papo/src/claude/project.ts - how a command run reads in a transcript (echo + notice); the harness writes the same two messages, typed
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.273 - supportedCommands() lists what Claude's runtime runs; the reference for internal commands
---

# AGENT-03 - Slash commands: internal ones the runtime lists and runs, external ones the client keeps

## Goal

A person types `/compact` and the runtime does it: the harness lists the command, runs it inside the turn loop, and writes the echo and the output into the transcript, exactly as Claude Code's runtime does for its own `/compact`.
Today papo does this in the client ([app.tsx:419-427](../../../../packages/papo/src/screen/app.tsx#L419-L427) calls `chat.compact()`), so on the Claude backend the screen shows Claude's `/compact` next to papo's, and the harness has no idea a command exists.
This plan moves every command that belongs to the runtime into the runtime (internal commands), leaves the client the few that are about the terminal (external commands), and makes the `/` menu the list the runtime gives, on both backends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "slash|SlashCommand" packages/agents/src` - nothing: the harness has no command concept.
- `rg "chat\.compact|controller\.compact" packages/papo/src` - the client command, the controller method, the shell action `compact <session>`, `Chat.compact()`.
- `papo --backend claude skills` on the real CLI (0.3.273) - what its runtime lists: `/compact /autocompact /clear /config /context /effort /model /rename /init /review /mcp /usage /cost /insights /memory /agents /doctor /output-style /fast /color ...` plus every skill. The runtime lists nearly everything; the client keeps the look.

### Runtime path (after this plan)

```
composer "/compact"  → Chat.say(text)
  → cofold backend: run({ agent, session, input })
      → start(): parseSlash(input) matches a listed command
      → store input message { role: 'user', source: 'command', parts: [text '/compact'] }
      → command.run({ agent, session, args, store, emit })      (compact: writes the summary message)
      → store output message { role: 'user', source: 'notice', parts: [text 'Compacted'] }
      → run.finished { status: 'completed' }; no model step
  → claude backend: the CLI runs its own; the transcript shows its echo and stdout
papo turns.ts: source 'command' → Turn.input; 'notice' → notice part; 'summary' → summary part
papo `/` menu = Chat.commands() + Chat.skills() + client commands whose name the runtime does not list
```

### Gaps

- No `SlashCommand` type, no registry, no interception in `start()`, no `command` / `notice` message sources, no events.
- `Chat` has `compact()` (a client-shaped method) and no `commands()`.
- papo's runtime-worthy commands are client commands with overlays (`chat.status`, `chat.cost`, `app.config`, `chat.skill`, `chat.compact`, `chat.autocompact`).
- The Claude backend types its commands as skills.
- `Not found: any test that types a slash command into the harness - searched "say('/" in packages/agents, packages/papo.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Two kinds, named so everywhere: an **internal command** is listed and run by the runtime (the harness, or Claude's CLI); an **external command** is the client's (papo's screen or shell) and never reaches the runtime. `/compact`, `/autocompact`, `/model`, `/reasoning`, `/permissions`, `/status`, `/cost`, `/config`, `/skills`, `/context` are internal. `/theme`, `/help`, `/quit`, `/markdown`, `/export`, `/retry`, `/clear`, `/memory` (opens an editor) are external | User (2026-09-16): "this was supposed to be a harness command, something that came from the runner, not made in the client"; the real CLI's `supportedCommands()` lists the internal ones above |
| 2 | `packages/agents/src/types/slash-command.ts`: `SlashCommand { name: string; description: string; argumentHint?: string; run(ctx: SlashCommandContext): Promise<string \| undefined> }` where `SlashCommandContext { agent, session, args: string, store, signal, emit }` and the returned text is the output (undefined: no output message). `name` matches `/^[a-z][a-z0-9_-]{0,63}$/` | One concept, one type; `RunCommand` (the handle's control) keeps its name, so this is a *slash* command throughout |
| 3 | Where commands come from: `AgentDefinition.slashCommands?: SlashCommand[]` and `Capability.slashCommands?(args): SlashCommand[]`, plus the harness's built-ins, resolved once by `createAgent` into `Agent.slashCommands: readonly SlashCommand[]` (definition's first, then capabilities', then built-ins; a later one of the same name is dropped with `AgentError('already_exists')` at `createAgent`, not at run time). `listSlashCommands(agent): SlashCommandInfo[]` (`{ name, description, argumentHint? }`) is exported | Same shape as tools and instructions; the program (papo) registers what is its own, the harness ships what is the harness's |
| 4 | Built-in: `compact` ("Fold the conversation so far into a summary the model continues from"; output `Compacted`). It runs the compaction step of p5 Task 6 (`run/compact.ts`) inside the command run: the summary message is written, then the notice. `compact()` as a separate exported run is removed; `contextOf` unchanged | The runtime owns compaction; a second entry point for the same thing is the boilerplate rule broken |
| 5 | Interception, in `start()` before the run record is written: a string input (or a single text part) matching `/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/` whose name is in `agent.slashCommands` is a *command run*: input message `{ role: 'user', source: 'command', parts: [{ type: 'text', text: <the line as typed> }] }`, `run.started`, `command.started { name, args }`, `run(ctx)`, output message `{ role: 'user', source: 'notice', parts: [text] }` when text came back, `command.finished { name, output? }`, `run.finished { status: 'completed', message: <output or input>, usage: 0, steps: 0 }`. A throw → `run.finished { status: 'failed', error }` with no notice. No model step, no tools, no hooks | Claude's transcript shape (echo, stdout) typed instead of marked up; a run so `wait` / `subscribe` / the store see it like any turn |
| 6 | A slash line whose name is not a listed command goes to the model as text, as today (a skill is invoked that way; so is a typo). A name that is both a command and a skill is the command | Claude does the same; the model never sees a command run |
| 7 | `MessageSource` gains `'command'` and `'notice'`; `contextOf` leaves both out of every request (they are the transcript's, not the model's). `listMessages` unchanged | The model does not read `Compacted`; Claude's `local-command-stdout` is not sent either |
| 8 | Events: `command.started { name, args }`, `command.finished { name, output? }` in `types/event.ts`, between `run.started` and `run.finished` | Same as every other step kind; a program can show "compacting..." |
| 9 | papo registers its internal commands in `buildAgent` (`packages/papo/src/agent.ts`) as `definition.slashCommands`, each a closure over `{ store, kv, config, providers, workspace, home }`: `status` (session, model, mode, reasoning, workspace, home, tokens so far), `cost` (usage per turn and total, from the run records), `config` (the redacted configuration as JSON), `skills` (the list `listSkills` gives), `context` (what the next request carries: messages counted, estimated tokens, the budget), `model [ref]` (no arg: the catalogue; an arg: set it), `reasoning [level]`, `permissions [mode]`, `autocompact [on\|off]` (no arg: show). The setters write the same `kv` settings `configure()` writes, so the chips and `session set` agree with them | The runtime runs them and the transcript records them; the words are papo's, so papo declares them, the harness only runs them |
| 10 | The overlays go: `PapoInfo` and `showInfo` are deleted with the client commands `chat.compact`, `chat.autocompact`, `chat.status`, `chat.cost`, `chat.skill`, `app.config`; their output is a notice in the transcript, where Claude puts it. `app.help` stays external and lists the runtime's commands (from `Chat.commands()`) and the client's | One place for a command's output; the screen test `answers /status, /cost, /config and /help ... in one overlay` is rewritten to read the notice |
| 11 | `Chat` gains `commands(): Promise<SlashCommandInfo[]>` and loses `compact()`; the shell action `compact <session>` is deleted (`papo say -s <id> /compact` is the way, as it is on the CLI); `papo commands` lists them beside `papo skills`. The `-a on\|off` flag on `say` / `session set` stays (a setting is settable outside a command) | The service exposes the runtime's list; a client-shaped method for one command is what went wrong |
| 12 | The `/` menu in the composer: `Chat.commands()` (kind `session`, sent as typed through `say`), then `Chat.skills()` (as today), then external commands whose name is not in the runtime's list (an external `clear` disappears on the Claude backend, which lists its own). A picked internal command with an `argumentHint` becomes the draft `/<name> ` for the person to finish; without one it is sent at once | One list, the runtime's names win; Claude's menu behaves so |
| 13 | Claude backend: `commands()` is `supportedCommands()` (`SlashCommandInfo` is what Claude's `SlashCommand` already is); `skills()` becomes the skills alone when the SDK tells them apart (0.3.273 does not: everything is in `supportedCommands()`, so `skills()` returns `[]` there and the list shows once); `say('/x')` passes through unchanged; the `autoCompact` refusal in `checkSettings` goes with the setting's special-casing (Claude's `/autocompact` is Claude's) | One `/compact` per backend; what is listed is what runs |
| 14 | Contract test (`chat-contract.test.ts`): the `compact` scenario becomes `say('/compact')` on both backends, asserting a turn whose input is `/compact`, a `summary` part somewhere, a `notice` part on that turn; a new `commands` scenario asserts `commands()` includes `compact` on both | Decision 10 of cli/03: the same story, the same snapshot |
| 15 | Not in this plan: steering (p5 Task 1), streaming (p5 Task 5, next after this), `/rename` (no title in the store), `/mcp`, Claude's other commands beyond listing them | Scope |
| 16 | `/help` is external: the client's overlay (`PapoInfo`) stays for it alone and lists `Chat.commands()` first, then the external commands | User (2026-09-16): external, overlay; Claude's CLI does it in the client |
| 17 | `/clear` is external in papo (start a new conversation; the store keeps the old one); on the Claude backend the runtime's `/clear` is listed and papo's is hidden, per decision 12 | User (2026-09-16) |
| 18 | `/model`, `/reasoning`, `/permissions`, `/autocompact` with no argument print the current value and the choices as a notice; the same in the shell and on the screen. Claude opens a picker for `/model`: a divergence logged in `deferred.md`, checked after this plan | User (2026-09-16) |
| 19 | The chips keep writing through `Chat.configure()`; a setting is data and a command is one way to set it. Chip changes are not echoed into the transcript | User (2026-09-16) |

## Proposed architecture

- **Data flow** - composer or shell → `Chat.say('/name args')` → cofold: `run()` → `start()` sees a listed name → command run (messages `command`, `notice`) → store; claude: the CLI. Reads: `Chat.commands()` → cofold: `listSlashCommands(agent)`; claude: `supportedCommands()`.
- **Event flow** - `run.started` → `command.started` → (`context.compacted` for `compact`) → `command.finished` → `run.finished`; papo's `subscribe` fires on each as today.
- **State flow** - settings changed by `/model`, `/reasoning`, `/permissions`, `/autocompact` land in the same `kv` record `configure()` writes; the next turn's agent is built from it (`agentFor`), the chips read it from the snapshot.
- **Layer responsibilities** - agents: the type, the registry, the interception, the two message sources, the events, `compact` · papo: its own internal commands (declared on the definition), `Chat.commands()`, the menu, the projection of `command` / `notice`, the deletion of the client copies · claude backend: the list from the SDK, pass-through.
- **Source-of-truth files** - `packages/agents/src/types/slash-command.ts`, `types/message.ts`, `types/event.ts`, `types/agent.ts`; `packages/papo/src/types/chat.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The slash command contracts](task-01-contracts.md) | todo | - |
| [02 - The registry, the interception in start(), and compact as a command](task-02-registry-built-ins.md) | todo | 01 |
| [03 - The harness README names slash commands](task-03-tests-readme.md) | todo | 02 |
| [04 - papo's Chat lists the runtime's commands and declares its own internal ones](task-04-service.md) | todo | 02 |
| [05 - The screen renders the runtime's list and keeps only the external commands](task-05-screen.md) | todo | 04 |
| [06 - The shell lists commands, loses the compact action, and the docs say internal and external](task-06-shell-docs.md) | todo | 04 |
| [07 - The Claude backend lists its own commands and nothing else](task-07-claude-backend.md) | todo | 04, 06 |

Tasks 01-03 are the harness, 04-06 papo, 07 the Claude backend.
The typecheck is red between 01 and 02 (a deleted type); `pnpm check` runs after 02.

## Risks and tradeoffs

- The transcript of an existing session with the old `compact()` run (input `source: 'system'` "Summarize the conversation so far.") still projects: `turns.ts` keeps `system` as an input. No migration.
- `/model` with no argument prints as a notice (decision 18); Claude's opens a picker. Logged in `deferred.md` to check after this plan.
- `PapoInfo` stays for `/help` alone (decision 16); every other overlay use goes.

## Resume state

- **Done so far:** plan written 2026-09-16 after the user found two `/compact` on the Claude backend.
- **Next action:** [task-01-contracts.md](task-01-contracts.md); then 02 (the typecheck is red between them), then 03-07 in the table's order. Build and commit per task; `pnpm check` after 02 and after every later task.
- **Open questions:** none; 1-4 were locked 2026-09-16 as decisions 16-19.
- **Watch out for:** `start()` must intercept before the writer claim is taken? No: a command run takes the claim like any turn (a `/compact` while a turn runs is `writer_busy`, as today).

## Final verification checklist

- [ ] `pnpm check` green.
- [ ] `papo` (cofold): `/compact`, `/status`, `/model` from the menu land in the transcript as input + notice; no overlay remains.
- [ ] `papo --backend claude`: the `/` menu lists Claude's commands once; `/compact` runs the CLI's.
- [ ] cli/02, cli/03, index.md updated.
