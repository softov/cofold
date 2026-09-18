---
title: Handoff - where the work stands (2026-09-16)
---

# Handoff

Written for: the next session, cold. Read this, then `.project/plans/index.md`, then the plan named under *Next*.

## Rules the user set this day (follow them before anything else)

   **A decision needs a real fork** (two options that both work, a nameable rejected alternative). A gap against Claude is a finding (`cli/03 F<n>`), fixed in a task and cited by number; a spec requirement is a task step. Neither gets a decision file (user, 2026-09-16, on the former decision 114: "it's not a decision, it's a defect"). A plan lists what it settled without a decision in a second table under *Decisions locked in*.
1. **Every decision is a file** in `.project/decisions/<slug>.md`; no file, no decision. A plan's table only links them. Each file names its source: the user's answer with the question quoted, a `code://` line, or `(defaulted: ...)` for something the writer chose and the user may erase. Written into `.agents/skills/do-spec/SKILL.md`.
2. **A decision that conflicts with the work means stop and ask** with `AskUserQuestion`, batched. Never resolve a fork silently, never narrow an outline while writing.
3. **Claude is contra-validation only.** papo runs on our harness (cli/01) and on the Claude Agent SDK (cli/03); every difference is a finding presumed to be the harness's bug. The harness is never a Claude API call; no `@facio/model-anthropic` ([decision 112](../decisions/no-anthropic-api-adapter.md)).
4. Read the plans that already exist before proposing anything as new; say plainly what was not read or verified.
5. `.project/` is searched by refs: `rg -n "code://<path>" .project/` finds what is decided or planned for a file (see the skill).

## State of the plans

| Plan | Status | Next |
| --- | --- | --- |
| [agent/01-p5](../plans/agent/01-harness-core-p5-streaming-context-usage/plan.md) | built 2026-09-16 (tasks 05, 07, 08 built this day; [implemented.md](../plans/agent/01-harness-core-p5-streaming-context-usage/implemented.md)) | nothing; cli/04 adopts `model.delta`, `contextOf`, the marker, `cost`, the stop reasons |
| [agent/04-policy-rules](../plans/agent/04-policy-rules/plan.md) | built 2026-09-16 (task 02 built after p5 task 07; [implemented.md](../plans/agent/04-policy-rules/implemented.md)) | nothing; papo's rule lists and the mode set are cli/04 task 04 |
| [cli/04-papo-harness-adoption](../plans/cli/04-papo-harness-adoption/plan.md) | built 2026-09-16 (tasks 01-04; [implemented.md](../plans/cli/04-papo-harness-adoption/implemented.md), [deferred.md](../plans/cli/04-papo-harness-adoption/deferred.md)) | the terminal runs (LM Studio, the real CLI); the user's word on `deferred.md`'s open rows (`memory_write` by default, the `rules` key, the `steer` name); `pnpm check` 67 files, 761 tests green |
| cli/03-papo-claude | built; task 04 (review fixes R1-R9) done 2026-09-16, `implemented.md` amended | the manual run on the real CLI with reasoning on (`/cost` after a split reply) is owed |
| [cli/05-papo-defaults-picker-thought](../plans/cli/05-papo-defaults-picker-thought/plan.md) | built 2026-09-16 (tasks 01-05; [implemented.md](../plans/cli/05-papo-defaults-picker-thought/implemented.md)); textui changed with it (`choices(collected)`, the thought's click and divider, the cursor bar) on the linked checkout | the runs by hand (two providers on the chip, arrowing through a transcript, a thought's click); publish textui 0.6.0; `pnpm check` 67 files, 775 tests green |

Decisions on disk after the review of 2026-09-16 (25 files reduced to 12, then CLI-04.6 added: 13): harness 102, 104, 105, 108, 109, 112, 117, 119, 120 and CLI-04.1, CLI-04.2, CLI-04.5, CLI-04.6 (`tool-subject-normalized-path.md`: a path tool's subject is the resolved path; `acceptEdits` is a mode check). The former 103, 106, 107, 110, 111, 113, 114, 115, 116, 118, 121, CLI-04.3, CLI-04.4 were gaps, spec items or scope, and live as task steps and as findings F1-F8 in cli/03's table (numbers 103-121 are not reused).

## Code changed this day (uncommitted; the user owns git)

- p5 tasks 01-04 built and green: steering, hook stop, effort levels, dynamic key, cache key (`packages/agents`, `packages/model-openai-compat`, `examples/agents/steer.ts`, `adapter-smoke.ts --effort`). `pnpm check`: 60 test files.
- Two renames at the user's ask, after that check: `execute` → `executeTool` (`run/tools.ts`, `run/turn.ts`); `compact()` moved from `run/run.ts` to `run/compact.ts` (`start()` exported from `run.ts`; `index.ts` and `compact.test.ts` updated). `@facio/agents` build, typecheck and 15 test files green; full `pnpm check` not re-run after the renames.

## What the next session should do, in order

1. Run `pnpm check` once (the renames were verified per package only).
2. p5 task 05 (streaming): built 2026-09-16. `toolCall.delta` is in the union, `DEFAULT_FEATURES.streaming` is true, `model.delta` carries `kind`.
3. p5 task 07 (usage, cost, `maxCost`, `tally()`) and task 08 (F1, F2, F4, F6, F7): built 2026-09-16; the plan is `built`.
4. agent/04 is built: task 02 extended p5's `tally()` with `denials` (`run/turn.ts`, `run/tools.ts` `deny(reason, by)`).
5. cli/04 is built (tasks 01-04, 2026-09-16); `@facio/tools`' file tools changed their `subject` with it (CLI-04.6). What waits is in its `deferred.md`.

## 2026-09-17: the stuck session (papo, harness)

- The user's session `27bbb76f` stuck: a message typed while a tool ran (a steer) met a turn that then asked permission; the harness rejected the steer `not_running`, papo started a new run, it failed `writer_busy` against the paused one and hid it. Decision [CLI-05.4](../decisions/papo-holds-a-steer-across-a-decision.md): papo holds the steer (`Queued.steer`, `Started.held`) and steers it into the resumed turn; harness decision 95 amended (a steer on a resumed handle waits while the request is open); `newest` reads the writer holder (`inForce`); `startHead` one at a time. Tests: `chat.test.ts` three new cases, `steering.test.ts` 5 and 5b. Committed (c82239d, 646bfbf).
- The user's run afterwards (2026-09-17): cancelling the paused turn on `27bbb76f` left the other queued messages showing as cancelled, not sent ("they get only as canceled"); queueing works but "the flow is something strange". Both accepted for now and to be re-tested with precision; nothing reproduced in a test yet. Start from `queues.hold` on cancel (CLI-04.1: nothing starts after a cancel until the person speaks) and how the screen labels a queued row once its session was cancelled.

## Things found and not yet acted on

- `list_files` / `search_files` take a `pattern`, not a path; decision 117 says so.
- The harness's `cancel` before `resume()` has read the run still detaches (decision 120 covers the awaiting case only; documented in p5 task 08 step 5). papo's `cancel` (cli/04 task 03) cancels the handle `handleFor` returns, which for a session left by another process is a fresh `resume()`; in the tests the deny lands, since `waitForCommand` checks the abort flag when it installs its listener.
- papo's Claude backend `cancel` on a pending decision denied it and let the turn go on; ahpd denies and interrupts. Fixed in cli/04 task 03 (the backend and the fake SDK); the real CLI was not run.
- The p2/p3 plan files were removed when they shipped, so decisions 46-94 exist only as numbers in code comments and in the parent plan's table; the user knows and did not ask for a backfill.
- cli/03 F8 answered (user, 2026-09-16) and built in cli/04 task 04: papo's permission modes are Claude's `default | acceptEdits | bypassPermissions | dontAsk` over `decide()`, `ToolEffects` and `rules()`; `plan` waits for a later plan after agent/03; `auto` is not offered. Open for the user (cli/04 `deferred.md`): whether `memory_write` should be allowed by default (it asks under `default` now; Claude writes its own memory unasked), the config key `rules` next to `permissions` (defaulted), the `steer` part name.
- cli/04's queue is in memory (CLI-04.1, user 2026-09-16), not kv as first drafted; task 01 says so.
  A message queued while the session is idle starts at once (user, 2026-09-16, "Start at once when idle"; CLI-04.1 amended, built 2026-09-16 with task 02).

## How to verify what this handoff claims

- `git status` in `f:\github\facio` shows the modified and new files listed above.
- `ls .project/decisions` shows 13 files.
- `rg -n "requireApproval" packages examples docs` finds nothing (agent/04 task 01 moved the three consumers to `decide`).
- `pnpm check` is green: 67 test files, 761 tests (2026-09-16, run three times after cli/04 closed).
- `rg -n "cli/03 F[0-9]" .project` shows every place a finding is cited; `rg -n "decision 1(0[367]|1[013456]|18|21)\b" .project packages` should find nothing (those numbers are retired).
