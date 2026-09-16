---
title: Handoff - where the work stands (2026-09-16)
---

# Handoff

Written for: the next session, cold. Read this, then `.project/plans/index.md`, then the plan named under *Next*.

## Rules the user set this day (follow them before anything else)

1. **Every decision is a file** in `.project/decisions/<slug>.md`; no file, no decision. A plan's table only links them. Each file names its source: the user's answer with the question quoted, a `code://` line, or `(defaulted: ...)` for something the writer chose and the user may erase. Written into `.agents/skills/do-spec/SKILL.md`.
2. **A decision that conflicts with the work means stop and ask** with `AskUserQuestion`, batched. Never resolve a fork silently, never narrow an outline while writing.
3. **Claude is contra-validation only.** papo runs on our harness (cli/01) and on the Claude Agent SDK (cli/03); every difference is a finding presumed to be the harness's bug. The harness is never a Claude API call; no `@facio/model-anthropic` ([decision 112](../decisions/no-anthropic-api-adapter.md)).
4. Read the plans that already exist before proposing anything as new; say plainly what was not read or verified.
5. `.project/` is searched by refs: `rg -n "code://<path>" .project/` finds what is decided or planned for a file (see the skill).

## State of the plans

| Plan | Status | Next |
| --- | --- | --- |
| [agent/01-p5](../plans/agent/01-harness-core-p5-streaming-context-usage/plan.md) | active; tasks 01-04, 06 built; 05, 07, 08 planned | `/dooit` [task-05-streaming.md](../plans/agent/01-harness-core-p5-streaming-context-usage/task-05-streaming.md), then 07, then 08 (F1, F2, F4, F5, F6) |
| [agent/04-policy-rules](../plans/agent/04-policy-rules/plan.md) | planned (F3: decide(), rules(), denials record, precedence) | task 01; independent of p5 |
| [cli/04-papo-harness-adoption](../plans/cli/04-papo-harness-adoption/plan.md) | planned (steer and queue, draft, model's view, stop reasons, rules) | task 01 now (needs only p5 task 02, built); 02-04 wait for p5 05-08 and agent/04 |
| cli/03-papo-claude | active; task 04 (review fixes) todo | unchanged this day |

Decisions written this day: harness 102-121 (`.project/decisions/`, one file each, titles start with the number) and CLI-04.1-5 (`papo-*.md`). 116-119 are agent/04's; 120-121 came from reading ahpd.

## Code changed this day (uncommitted; the user owns git)

- p5 tasks 01-04 built and green: steering, hook stop, effort levels, dynamic key, cache key (`packages/agents`, `packages/model-openai-compat`, `examples/agents/steer.ts`, `adapter-smoke.ts --effort`). `pnpm check`: 60 test files.
- Two renames at the user's ask, after that check: `execute` → `executeTool` (`run/tools.ts`, `run/turn.ts`); `compact()` moved from `run/run.ts` to `run/compact.ts` (`start()` exported from `run.ts`; `index.ts` and `compact.test.ts` updated). `@facio/agents` build, typecheck and 15 test files green; full `pnpm check` not re-run after the renames.

## What the next session should do, in order

1. Run `pnpm check` once (the renames were verified per package only).
2. `/dooit` p5 task 05 (streaming). Its decisions: 102-107. Watch: `toolCall.delta` stays in the adapter union (the user restored it); `DEFAULT_FEATURES.streaming` flips to true.
3. Then p5 task 07 (usage, decisions 108-110), then task 08 (F1, F2, F4, F5, F6; decisions 113-115, 120, 121).
4. agent/04 can be built in parallel by another session (no overlap with p5 files except `run/tools.ts` and `types/store.ts`; coordinate the `tally()` helper that both p5 task 07 and agent/04 task 02 introduce; whoever is second reuses it).
5. cli/04 task 01 can be built now; the rest after the harness tasks.

## Things found and not yet acted on

- `list_files` / `search_files` take a `pattern`, not a path; decision 117 says so.
- The harness's `cancel` before `resume()` has read the run still detaches (decision 120 covers the awaiting case only; documented in p5 task 08 step 4).
- The p2/p3 plan files were removed when they shipped, so decisions 46-94 exist only as numbers in code comments and in the parent plan's table; the user knows and did not ask for a backfill.

## How to verify what this handoff claims

- `git status` in `f:\github\facio` shows the modified and new files listed above.
- `ls .project/decisions` shows 25 files.
- `rg -n "requireApproval" packages` shows the three consumers agent/04 task 01 moves.
