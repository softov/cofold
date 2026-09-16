---
title: CLI-04 - papo adopts the harness's p5 and agent/04: steer and queue, partial text, the model's view, stop reasons, rules
domain: cli
status: planned
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
  - decisions/papo-hides-compacted-history.md
  - decisions/papo-stopped-reason-states.md
  - decisions/papo-rules-in-config-and-session.md
  - decisions/cancel-denies-pending-request.md
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

papo over `@facio/agents` feels like Claude Code for the same acts: a message typed while the model answers steers it or waits its turn; the answer appears as it is written; after a compaction the screen shows what the model sees; a turn ended by a hook is finished and one ended by a limit says which; permission rules are in the config and per session.

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
  → chat.queue → kv papo/session/<id>/queue; on settle completed|stopped|failed → say(head)
attach: for await event of handle.events
  → model.delta → draft[sessionId] = fold(...)                  (decision CLI-04.2)
  → model.completed → draft cleared
  → notify → projectTurns({ messages: contextOf(all), runs, pending, errors, draft })   (decision CLI-04.3)
stateOf(run, outcome): stopped hook → complete; other stopped → failed 'stopped: <reason>'   (decision CLI-04.4)
buildAgent: rules({ ...merge(config.permissions.rules, settings.rules), otherwise: policyOf(mode).decide })   (decision CLI-04.5)
```

### Gaps

- `Not found: a queue, a draft, contextOf in papo, a stop-reason mapping, a rules config` - all five are new.
- papo's own deny-on-cancel duplicates what the harness does after p5 task 08 (decision 120); it goes.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| [CLI-04.1](../../../decisions/papo-steers-and-queues.md) | `say` during a running turn steers; `not_running` → new run; `queue` / `unqueue` in the session kv; the head starts on settle, never after a cancel | User (2026-09-16) |
| [CLI-04.2](../../../decisions/papo-draft-from-handle.md) | The draft is folded from the handle's `model.delta` in memory and cleared at `model.completed` | User (2026-09-16, after the reasons were given) |
| [CLI-04.3](../../../decisions/papo-hides-compacted-history.md) | `projectTurns` projects `contextOf`; `session show --all` prints everything | User (2026-09-16) |
| [CLI-04.4](../../../decisions/papo-stopped-reason-states.md) | `stopped hook` → `complete`; other `stopped` → `failed` with `stopped: <reason>` | User (2026-09-16) |
| [CLI-04.5](../../../decisions/papo-rules-in-config-and-session.md) | `permissions.rules` in the config and `Settings.rules` per session; `session set --deny/--ask/--allow`, `session rules` | User (2026-09-16); the `always` → allow list mapping is `(defaulted)` in the file |
| [120](../../../decisions/cancel-denies-pending-request.md) | The harness denies a pending request on cancel; papo's own deny goes | User (2026-09-16) |

## Proposed architecture

- **Data flow** - `chat.ts` gains `queue`, `unqueue`, a `drafts` map and `contextOf` in `snapshot`; `turns.ts` takes `draft` and a `stateOf` that reads the outcome's `reason`; `agent.ts` builds the policy with `rules()`; `config.ts` and `types/settings.ts` carry the rule lists.
- **Event flow** - `attach` reads `model.delta` (the first event payload papo reads), `model.completed`, `run.finished` (to start the queue head); everything else still only wakes.
- **State flow** - queue in kv (survives the process); draft in memory (dies with the step); rules in config and kv settings.
- **Layer responsibilities** - `chat.ts` service · `turns.ts` / `blocks.ts` projection · `screen/*` chips and the steer-or-queue choice · `commands.ts` shell actions · `config.ts` schema.
- **Source-of-truth files** - `code://packages/papo/src/types/settings.ts`, `code://packages/papo/src/types/turn.ts`, `code://packages/papo/src/types/config.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Steer and queue](task-01-steer-and-queue.md) | todo | agent/01-p5 task 02 (built) |
| [02 - Partial text from the draft](task-02-draft.md) | todo | agent/01-p5 task 05 |
| [03 - The model's view and the stop reasons](task-03-view-and-stop-reasons.md) | todo | agent/01-p5 tasks 07, 08 |
| [04 - Rules in the config and per session](task-04-rules.md) | todo | agent/04 |

## Risks and tradeoffs

- The queue starts the head from inside the settle callback; a head that fails to start (model down) is left in the queue and reported once through `warn`, not dropped.
- Hiding compacted turns changes what a person sees of their own history; `session show --all` and the store keep it. Same as the Claude backend today.
- A rule typed at the shell (`shell_exec(rm *)`) is parsed with one syntax, `Tool(match)`; a typo becomes a rule on a tool that does not exist, which matches nothing and is listed by `session rules` so it can be seen.

## Resume state

- **Done so far:** planned 2026-09-16; decisions CLI-04.1-5 as files.
- **Next action:** [task-01-steer-and-queue.md](task-01-steer-and-queue.md) (only its dependency is built); tasks 02-04 wait for their harness tasks.
- **Open questions:** none.
- **Watch out for:** task 02 needs `model.delta { kind }` from p5 task 05; task 03 needs `contextOf` exported, `context.compacted.afterTokens`, `stopped.reason` values and decision 120 from p5 tasks 07 and 08; task 04 needs `rules()` and `Tool.subject` from agent/04.

## Final verification checklist

- [ ] `pnpm check` green.
- [ ] Typing during an answer steers it (the transcript shows the message after the tool result); a queued message starts when the answer ends and not after a cancel.
- [ ] Text appears as it streams in the screen; a second process sees it whole at completion.
- [ ] After `/compact` the screen shows the summary (with "N tokens to M"), the tail and the ask; `session show --all` prints everything.
- [ ] A `notify_done` turn shows complete; a `max_cost` turn shows failed with `stopped: max_cost`.
- [ ] `session set --deny 'shell_exec(rm *)'` refuses `rm` and `session rules` lists it; a config rule applies to every session.
- [ ] `plans/index.md` updated.
