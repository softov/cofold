---
title: AGENT-03 - Slash commands: runtime commands the harness runs, prompt commands it expands, client commands the client keeps
domain: agent
status: planned
priority: high
created: 2026-09-16
revalidated: 2026-10-11
requires:
  - plans/agent/01-harness-core-p5-streaming-context-usage/plan.md
  - plans/cli/03-papo-claude/plan.md
decisions:
  - decisions/slash-commands-run-in-the-runtime.md
  - decisions/slash-command-sources.md
  - decisions/transcript-only-message-sources.md
  - decisions/compact-stays-as-a-wrapper.md
  - decisions/papo-queues-a-slash-line-during-a-turn.md
  - decisions/papo-declares-its-own-runtime-commands.md
  - decisions/claude-backend-lists-its-commands-once.md
refs:
  - "[code://packages/agents/src/run/run.ts#L71-L115](../../../../packages/agents/src/run/run.ts#L71-L115) - `setupRun`: run record, claim, capabilities, input message, `run.started`"
  - "[code://packages/agents/src/run/compact.ts#L52-L80](../../../../packages/agents/src/run/compact.ts#L52-L80) - `writeSummary`, which uses the run's input as the ask in a `compact()` run"
  - "[code://packages/agents/src/run/turn.ts#L221-L233](../../../../packages/agents/src/run/turn.ts#L221-L233) - the loop's compact branch"
  - "[code://packages/agents/src/run/context.ts#L45-L50](../../../../packages/agents/src/run/context.ts#L45-L50) - `contextOf`"
  - "[code://packages/agents/src/types/capability.ts#L18-L36](../../../../packages/agents/src/types/capability.ts#L18-L36) - `Capability`"
  - "[code://packages/agents/src/capabilities/skills.ts](../../../../packages/agents/src/capabilities/skills.ts) - `skills()` and `listSkills`"
  - "[code://packages/agents/src/types/agent.ts#L45-L64](../../../../packages/agents/src/types/agent.ts#L45-L64) - `AgentOptions`, which gets `slashCommands`"
  - "[code://packages/papo/src/chat.ts#L436-L478](../../../../packages/papo/src/chat.ts#L436-L478) - `say`, which steers a running turn, and `compact`"
  - "[code://packages/papo/src/agent.ts#L41-L73](../../../../packages/papo/src/agent.ts#L41-L73) - `buildAgent`"
  - "[code://packages/papo/src/screen/app.tsx#L387-L678](../../../../packages/papo/src/screen/app.tsx#L387-L678) - the client commands"
  - "[code://packages/papo/src/claude/chat.ts#L356-L359](../../../../packages/papo/src/claude/chat.ts#L356-L359) - Claude `skills()`"
  - git://5da7143 - the plan as written on 2026-09-16, before this revalidation
---

# AGENT-03 - Slash commands

## Goal

A person types `/compact` and the runtime runs it.
The harness lists the command, runs it as a turn, and writes the typed line and the output to the transcript.
A person types `/review` and the harness puts the skill's text in the turn, so the model acts on it at once.
papo keeps only the commands that are about its terminal, and its `/` menu shows the runtime's list on both backends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "slash|SlashCommand" packages/agents/src` - nothing; the harness has no command concept.
- `rg "compact" packages/papo/src` - `Chat.compact()`, the screen's `chat.compact`, the shell and MCP action `compact <session>`.
- `/github/pi` `agent-session.ts` - pi registers extension commands at load, and expands `/skill:<name>` in the session.

### Three kinds of slash line

```
/name args
 ├─ runtime command  (compact, status, usage, model, ...)  -> the harness runs it; no model step, except /compact
 ├─ prompt command   (each skill)                          -> the harness expands it; the model acts on it
 └─ client command   (help, theme, quit, clear, ...)        -> papo's screen; never reaches the runtime
anything else                                               -> the model, as text
```

### Where the commands come from

```
createAgent                                  per session
 ├─ AgentOptions.slashCommands  (papo's)      └─ Capability.prompts({ workspace })
 ├─ Capability.slashCommands    (fixed)           └─ skills(): one per skill
 └─ built-ins: compact
 = Agent.slashCommands  -> listSlashCommands(agent)      = listPromptCommands(agent, { workspace })
```

### Runtime path

```
say('/compact')
 └─ run() -> setupRun: record, claim, capabilities
      ├─ runtime command: input { source: command } -> command.started -> run(ctx) -> { source: notice } -> command.finished -> run.finished
      ├─ /compact:        input { source: command } -> one model step writes the summary -> { source: notice } -> run.finished
      ├─ prompt command:  input { source: input } + { source: skill } -> the model step as usual
      └─ otherwise:       input { source: input } -> the model step as usual
```

### Gaps

- No `SlashCommand` type, no list on the agent, no recognition in `setupRun`, no `command`, `notice` or `skill` source, no events.
- `writeSummary` uses a `compact()` run's input as the ask; a `command` input is out of the request, so the ask would be lost.
- `skills()` tells the model to read a skill on `/<name>`; the harness does not expand it.
- papo's `say` steers a slash line into a running turn.
- papo runs `/compact`, `/status`, `/usage`, `/config`, `/skills` and `/autocompact` in the client.
- The Claude backend lists its commands as skills.

## Decisions locked in

| # | Decision |
| --- | --- |
| 1 | [A runtime command is a run in the harness, and a client command never reaches the runtime](../../../decisions/slash-commands-run-in-the-runtime.md) |
| 2 | [Runtime commands are a fixed list at createAgent; skills are prompt commands the harness expands per session](../../../decisions/slash-command-sources.md) |
| 3 | [The command and notice sources stay out of every request; the skill source goes to the model](../../../decisions/transcript-only-message-sources.md) |
| 4 | [compact() stays exported and runs /compact](../../../decisions/compact-stays-as-a-wrapper.md) |
| 5 | [papo queues a slash line typed while a turn runs](../../../decisions/papo-queues-a-slash-line-during-a-turn.md) |
| 6 | [papo declares /status, /usage, /model and the setting commands](../../../decisions/papo-declares-its-own-runtime-commands.md) |
| 7 | [On the Claude backend, commands() is supportedCommands() and skills() is empty](../../../decisions/claude-backend-lists-its-commands-once.md) |

| What | Source | Task |
| --- | --- | --- |
| `SlashCommand { name, description, argumentHint?, run(ctx) }`; `run` returns the output text or `undefined`; `name` matches `^[a-z][a-z0-9_-]{0,63}$` | Softov, 2026-09-16 | 01 |
| A duplicate runtime command name fails `createAgent` with `invalid_options`, as a duplicate capability id does | `create-agent.ts` | 02 |
| A line is a command when it is a string or one text part matching `^/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$`; text with an image is never a command | (defaulted: a command takes text) | 02 |
| A name that is a runtime command and a skill is the runtime command; an unknown name goes to the model as text | Softov, 2026-09-16; Claude does the same | 02, 03 |
| A command run emits `command.started { name, args }` and `command.finished { name, output? }` between `run.started` and `run.finished` | follows decision 1 | 01, 02 |
| A command that throws ends the run `failed` with no notice | (defaulted: as a failed step) | 02 |
| `/compact` makes one model call, so its run counts that step, its usage and its cost | `writeSummary` | 02 |
| `/compact` sends a new ask and puts the `command` message in `summarizes` | `contextOf` drops `command` messages | 02 |
| Client commands: `/help`, `/theme`, `/quit`, `/markdown`, `/export`, `/memory`, `/clear`, `/retry`, and the turn controls (stop, queue, unqueue, approve, deny) | Softov, 2026-09-16; refreshed 2026-10-11 | 06 |
| `/usage` is a runtime command, like `/status` | Softov, 2026-10-11, asked "Is /usage (was /cost) an internal command like /status?": "Internal" | 05 |
| `/model`, `/reasoning`, `/permissions` and `/autocompact` with no argument write the current value and the choices as a notice | Softov, 2026-09-16 | 05 |
| The choices for `/reasoning` and `/permissions` come from `EFFORT_LEVELS` and `PERMISSION_MODES` as papo offers them | agent/06 | 05 |
| The chips keep writing through `Chat.configure()`, and a chip change is not written to the transcript | Softov, 2026-09-16 | 05 |
| The `/` menu: runtime commands, then prompt commands, then client commands whose name the runtime does not list; a runtime command replaces the `compose.*` entry of the same name | Softov, 2026-09-16; `compose.model` is in the palette today | 06 |
| A picked command with an `argumentHint` becomes the draft `/<name> `; one without is sent at once | Softov, 2026-09-16 | 06 |
| `/help` keeps its overlay and lists the runtime's commands first; `/memory`, `/export` keep theirs | Softov, 2026-09-16; `showInfo` serves them | 06 |
| `Chat` gets `commands()` and loses `compact()`; the shell and MCP action `compact <session>` goes; `papo commands` lists them | Softov, 2026-09-16 | 05, 07 |
| The contract test runs `say('/compact')` on both backends, and a `commands` scenario finds `compact` on both | cli/03 decision 10 | 07, 08 |
| `@cofold/agents` goes to 0.2.2, and ahpd's agent-cofold suite passes against it before the release | decision 4; the memory test-the-consumer-before-a-release | 04 |

## Proposed architecture

- **Data flow** - `say('/name args')` → `run()` → `setupRun` reads the line → a runtime command run, a prompt expansion, or a model turn.
- **Event flow** - `run.started` → `command.started` → (`context.compacted` for `/compact`) → `command.finished` → `run.finished`.
- **State flow** - `/model`, `/reasoning`, `/permissions` and `/autocompact` write the settings record that `configure()` writes; the next turn's agent reads it.
- **Layer responsibilities**
  - agents: the types, the lists, recognition, the sources, the events, `/compact` and skill expansion.
  - papo: its runtime commands, `commands()`, the queue for a slash line, and the menu.
  - papo on Claude: the SDK's list, passed through.
- **Source-of-truth files** - `packages/agents/src/types/slash-command.ts`, made by task 01; [`code://packages/agents/src/types/message.ts`](../../../../packages/agents/src/types/message.ts); [`code://packages/papo/src/types/chat.ts`](../../../../packages/papo/src/types/chat.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The slash command contracts](task-01-contracts.md) | implemented | - |
| [02 - The harness runs a runtime command, and /compact is one](task-02-the-harness-runs-a-command.md) | implemented | 01 |
| [03 - The harness expands a skill](task-03-the-harness-expands-a-skill.md) | implemented | 01 |
| [04 - The README describes slash commands, and agents 0.2.2 passes ahpd's suite](task-04-docs-and-release-check.md) | todo | 02, 03 |
| [05 - papo's Chat lists the runtime's commands and declares its own](task-05-papo-service.md) | implemented | 02, 03 |
| [06 - The screen shows the runtime's list and keeps only client commands](task-06-papo-screen.md) | todo | 05 |
| [07 - The shell lists commands and loses the compact action](task-07-papo-shell.md) | todo | 05 |
| [08 - The Claude backend lists its own commands](task-08-claude-backend.md) | todo | 05, 07 |

## Risks and tradeoffs

- A session written before this plan has `compact()` runs with a `system` ask; `turns.ts` keeps `system` as an input, so it still shows.
- ahpd shows `command`, `notice` and `skill` messages as user text until it maps them; see [deferred.md](deferred.md).
- A program that steers a slash line through `handle.steer` sends text to the model; only papo's `say` queues it.

## Resume state

- **Done so far:** revalidated 2026-10-11 against `4174eeb`; tasks 01, 02, 03 and 05 implemented on `build/agents/a03`, awaiting review.
- **Next action:** [task-04-docs-and-release-check.md](task-04-docs-and-release-check.md) and [task-06-papo-screen.md](task-06-papo-screen.md).
- **Open questions:** none.
- **Watch out for:** `/compact` makes a model call; a test that expects no model request is wrong.

## Final verification checklist

- [ ] `say('/compact')` writes a `command`, a `summary` and a `notice` message on the cofold backend, and no request carries the `command` or the `notice`.
- [ ] `say('/review x')` on a session with a `review` skill sends the skill's text and `x` in the first model request.
- [ ] A slash line typed during a turn starts after the turn, as its own run.
- [ ] `compact()` still works and writes `/compact` as its input.
- [ ] The `/` menu shows each name once on both backends.
- [ ] `pnpm check` passes; ahpd's agent-cofold suite passes against the packed `@cofold/agents`.
- [ ] `plans/index.md` updated.
