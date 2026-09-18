---
title: CLI-04 - papo adopts the harness's p5 and agent/04: steer and queue, partial text, the model's view, stop reasons, rules
domain: cli
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/cli/01-papo/plan.md
  - plans/agent/01-harness-core-p5-streaming-context-usage/plan.md
  - plans/agent/04-policy-rules/plan.md
decisions:
  - decisions/papo-steers-and-queues.md
  - decisions/papo-draft-from-handle.md
  - decisions/papo-rules-in-config-and-session.md
  - decisions/cancel-denies-pending-request.md
  - decisions/tool-subject-normalized-path.md
refs:
  - code://packages/papo/src/chat.ts#L108-L121 - `attach`: iterates `handle.events` to wake listeners; the draft is folded here
  - code://packages/papo/src/chat.ts#L237-L260 - `say`: refuses `writer_busy` while a run is attached; becomes steer
  - code://packages/papo/src/chat.ts#L262-L272 - `compact`
  - code://packages/papo/src/chat.ts#L281-L292 - `cancel`: denies a waiting request itself (cli/01 decision 6); the harness does it after p5 task 08 (decision 120)
  - code://packages/papo/src/turns.ts#L27-L60 - `projectTurns`: store-only projection; gains `draft` and `contextOf`
  - code://packages/papo/src/turns.ts#L86-L89 - `stateOf`: `stopped` → `cancelled`
  - code://packages/papo/src/turns.ts#L64 - the error part from `input.errors[runId]`
  - code://packages/papo/src/blocks.ts#L28-L35 - prose / reasoning blocks with `streaming`; the summary notice
  - code://packages/papo/src/claude/project.ts#L20-L21,L53-L60 - the Claude backend's projection: summary first, tail, echo; interrupt notices
  - code://packages/papo/src/agent.ts#L33-L39,L66,L80 - `policyOf`, reasoning, the policy handed to `createAgent`
  - code://packages/papo/src/config.ts#L28-L29,L98 - `permissions`, `reasoning` in the schema and defaults
  - code://packages/papo/src/types/settings.ts#L12-L16 - `Settings { model, permissions, reasoning }`
  - code://packages/papo/src/commands.ts#L394 - the shell's `stopped` line
  - code://packages/papo/src/screen/chat.tsx#L40-L48,L128 - the composer chips (`compose.model`, `compose.permissions`, `compose.reasoning`) and `openPicker`
  - code://packages/papo/src/screen/app.tsx#L333-L358 - the palette commands behind the chips
  - code://.project/plans/cli/01-papo/plan.md#L24-L43 - cli/01 decisions 2, 3, 4, 6, 12, 17, 18, 19, 20 this plan amends or builds on
  - code://ahpd/packages/sdk/src/types/session.ts#L244-L294 - `steer`, `queue`, `unqueue`, `reorder`, the reference contract
---

## Goal

papo over `@facio/agents` feels like Claude Code for the same acts: a message typed while the model answers steers it or waits its turn; the answer appears as it is written; after a compaction the screen shows what the model sees; a turn ended by a hook is finished and one ended by a limit says which; permission modes are Claude's and rules are in the config and per session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "writer_busy" packages/papo/src` - `say` and `compact` refuse a busy session; `cancel` and `remove` do not.
- `rg -n "model.delta|streaming" packages/papo/src` - the flag exists on blocks; nothing feeds it.
- `rg -n "queue" packages/papo/src .project/plans/cli` - no queue anywhere in papo.
- `rg -n "stopped" packages/papo/src` - `turns.ts:89` and `commands.ts:394`.
- `rg -n "alwaysApprove|ALWAYS" packages/papo/src` - `chat.ts:276` (`approve({ always })`), `turns.ts:20`, `claude/permissions.ts:38`.

### Runtime path

```
screen composer / shell `say` while a run is attached
  → chat.say → handle.submit({ type: 'steer', text })          (decision CLI-04.1)
      not_running → run() with the same text
  → chat.queue → in-memory queue next to the attached handle; on settle completed|stopped|failed → say(head)
attach: for await event of handle.events
  → model.delta → draft[sessionId] = fold(...)                  (decision CLI-04.2)
  → model.completed → draft cleared
  → notify → projectTurns({ messages: contextOf(all), runs, pending, errors, draft })   (cli/03 F1)
stateOf(run, outcome): stopped hook → complete; other stopped → failed 'stopped: <reason>'   (decision 97)
buildAgent: rules({ deny, ask, allow: [...policyOf(mode).allow, ...session, ...config], otherwise: policyOf(mode).otherwise })   (cli/03 F8, decision CLI-04.5)
```

### Gaps

- `Not found: a queue, a draft, contextOf in papo, a stop-reason mapping, a rules config` - all five are new.
- papo's own deny-on-cancel duplicates what the harness does after p5 task 08 (decision 120); it goes.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| [CLI-04.1](../../../decisions/papo-steers-and-queues.md) | papo holds a queue of next turns in memory (as ahpd); the head starts on settle, never after a cancel | User (2026-09-16) |
| [CLI-04.2](../../../decisions/papo-draft-from-handle.md) | The draft is folded from the handle's `model.delta` in memory and cleared at `model.completed` | `(defaulted)`; the user asked "what is the correct?" and the writer chose |
| [CLI-04.5](../../../decisions/papo-rules-in-config-and-session.md) | `permissions.rules` in the config and `Settings.rules` per session; `always` adds a session allow rule, as Claude's `updatedPermissions` does | User (2026-09-16); `always` follows the reference |
| [120](../../../decisions/cancel-denies-pending-request.md) | The harness denies a pending request on cancel; papo's own deny goes | User (2026-09-16); cli/03 F6 |
| [CLI-04.6](../../../decisions/tool-subject-normalized-path.md) | A path tool's subject is the resolved path (relative inside the workspace, absolute outside); `acceptEdits` is the mode's own check on where the edit goes, not an allow rule | User (2026-09-16), "Normalized subject + mode check" |

Settled without a decision, because the harness already has it or the reference leaves no fork (details in the task steps):

| What | Source | Task |
| --- | --- | --- |
| `say` during a running turn sends `submit({ type: 'steer' })`; `not_running` → a new run | decision 95 (the harness takes steers; papo refusing `writer_busy` was the gap) | 01 |
| `projectTurns` projects `contextOf`, the model's view; `session show --all` prints everything | cli/03 F1 | 03 |
| `stopped { reason: 'hook' }` → `complete`; every other `stopped` → `failed` with `stopped: <reason>` | decision 97 gave `stopped` a reason; mapping every `stopped` to `cancelled` was wrong since | 03 |
| papo's permission modes become Claude's `default \| acceptEdits \| bypassPermissions \| dontAsk`, mapped onto `decide()`, `ToolEffects` and `rules()`; `plan` waits for a later plan (prompt-level, needs agent/03), `auto` left out (the assistant's recommended option, not the user's ask; open in `deferred.md`); papo's `ask`, `destructive`, `auto` go | cli/03 F8 (user, 2026-09-16, chose the recommended four) | 04 |

## Proposed architecture

- **Data flow** - `chat.ts` gains `queue`, `unqueue`, a `drafts` map and `contextOf` in `snapshot`; `turns.ts` takes `draft` and a `stateOf` that reads the outcome's `reason`; `agent.ts` builds the policy with `rules()`; `config.ts` and `types/settings.ts` carry the rule lists.
- **Event flow** - `attach` reads `model.delta` (the first event payload papo reads), `model.completed`, `run.finished` (to start the queue head); everything else still only wakes.
- **State flow** - queue in memory (dies with the process, as ahpd's); draft in memory (dies with the step); rules in config and kv settings.
- **Layer responsibilities** - `chat.ts` service · `turns.ts` / `blocks.ts` projection · `screen/*` chips and the steer-or-queue choice · `commands.ts` shell actions · `config.ts` schema.
- **Source-of-truth files** - `code://packages/papo/src/types/settings.ts`, `code://packages/papo/src/types/turn.ts`, `code://packages/papo/src/types/config.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Steer and queue](task-01-steer-and-queue.md) | done | agent/01-p5 task 02 (built) |
| [02 - Partial text from the draft](task-02-draft.md) | done | agent/01-p5 task 05 |
| [03 - The model's view and the stop reasons](task-03-view-and-stop-reasons.md) | done | agent/01-p5 tasks 07, 08 |
| [04 - Permission modes as Claude's; rules in the config and per session](task-04-rules.md) | done | agent/04 |

## Risks and tradeoffs

- The queue starts the head from inside the settle callback; a head that fails to start (model down) is left in the queue and reported once through `warn`, not dropped.
- Hiding compacted turns changes what a person sees of their own history; `session show --all` and the store keep it. Same as the Claude backend today.
- A rule typed at the shell (`shell_exec(rm *)`) is parsed with one syntax, `Tool(match)`; a typo becomes a rule on a tool that does not exist, which matches nothing and is listed by `session rules` so it can be seen.

## Resume state

- **Done so far:** planned 2026-09-16; decisions CLI-04.1, CLI-04.2, CLI-04.5 as files; the rest of the plan applies decisions 95, 97 and finding F1.
  Task 01 built 2026-09-16: `say` steers, `queue` / `unqueue` / `queued` on `Chat` and both backends through `src/queue.ts`, `Snapshot.queued`, the `steer` turn part, the shell actions, the Queue chip and queued rows on the screen; 101 papo tests and `pnpm check` (736) green.
  Task 02 built 2026-09-16: `Draft` folded from `model.delta` in `attach`, `ProjectionInput.draft`, the `streaming` draft parts, `testChat({ stream, afterDelta })`; with it the idle-queue answer (`queue.ts` starts the head at once while idle, both backends); 106 papo tests green.
  Task 03 built 2026-09-16: `snapshot` over `contextOf` (`--all` for everything), the compaction turn `(context compacted)` with `Context compacted: N tokens to M.`, `stateOf(run, stopped)`, the marker as a notice, `cancel` on the handle (decision 120, the Claude backend's cancel denies and interrupts as ahpd's); 111 papo tests green.
  Task 04 built 2026-09-16 after the user answered its fork (CLI-04.6): the four modes over the tools' effects, `rules()` from the config's and the session's lists, `always` as a session allow rule, the Claude pass-through, `session set --deny/--ask/--allow`, `session rules`, the chip; the file tools' subjects normalized in `@facio/tools`; 117 papo tests green.
- **Next action:** none; the plan is built ([implemented.md](implemented.md), [deferred.md](deferred.md)).
- **Open questions:** the `TurnPart` name `steer` (task 01's Resume); the config key `rules` next to `permissions` where CLI-04.5 wrote `permissions.rules` (task 04's Resume, defaulted); whether `memory_write` should be allowed by default under `default` (task 04's Resume).
  A queued message on an idle session starts at once (user, 2026-09-16; CLI-04.1 amended; built with task 02, `Queues.add` async over `QueueDeps.idle`).
- **Watch out for:** a rule's `match` on a file tool sees the resolved path (relative inside the workspace, absolute outside; CLI-04.6), never what the model typed. `alt+enter` is textui's newline: the queue is reached by the chip and `/queue`. Tasks 02 and 03 read two event payloads in `attach` (`model.delta`, `context.compacted`); nothing else is read from events but the last `run.finished` of failed and stopped runs. On the Claude backend a permission mode change restarts the process (the SDK wants `allowDangerouslySkipPermissions` with `bypassPermissions`).

## Final verification checklist

- [x] `pnpm check` green after task 01 (66 files, 736 tests), after task 03 (67 files, 755 tests) and after task 04 (67 files, 761 tests, no type errors).
- [x] Typing during an answer steers it (the transcript shows the message after the tool result); a queued message starts when the answer ends and not after a cancel (task 01: `chat.test.ts`, `chat-contract.test.ts` on both backends, `screen.test.ts`; the terminal run itself is owed).
- [x] Text appears as it streams in the screen; a second process sees it whole at completion (task 02: `chat.test.ts`, `turns.test.ts`; the LM Studio run itself is owed).
- [x] After `/compact` the screen shows the summary (with "N tokens to M") and the tail; the ask is covered by the summary and gone from the view; `session show --all` prints everything (task 03: `chat.test.ts`, `commands.test.ts`, `screen.test.ts`).
- [x] A hook-stopped turn shows complete and a limit-stopped one failed with `stopped: <reason>` (task 03: `turns.test.ts` for `hook` and `max_cost`, `chat.test.ts` for `max_tool_calls` end to end; papo has no hook slot for an end-to-end `notify_done`).
- [x] `permissions: default` asks for `write_file` and runs `read_file`; `acceptEdits` edits inside the workspace unasked; `dontAsk` denies instead of asking; a session or config deny rule refuses under `bypassPermissions` and `session rules` lists it; a config rule applies to every session (task 04: `chat.test.ts`, `commands.test.ts`, `config.test.ts`; the terminal run itself is owed).
- [x] `plans/index.md` updated.
