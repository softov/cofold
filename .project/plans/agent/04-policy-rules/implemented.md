---
title: AGENT-04 - Policy rules: allow, ask or deny per tool call, recorded on the run - implemented
date: 2026-09-16
refs:
  - git://1705e4ff6d3f2bd0bdf9ffa886560537d1d637d8 - the last commit before this plan's work; everything below is uncommitted on top of it
  - code://packages/agents/src/types/agent.ts - `Policy { decide }`, `PolicyDecision`
  - code://packages/agents/src/types/policy.ts - `Rule`, `RulesOptions`
  - code://packages/agents/src/policy/rules.ts - `DEFAULT_DECIDE`, `matchGlob`, `rules`
  - code://packages/agents/src/run/tools.ts - the precedence and the `deny(reason, by)` helper
  - code://packages/agents/src/types/store.ts - `Denial`, `RunRecord.denials`
  - code://packages/agents/src/run/turn.ts - `tally()` carrying `denials`; the limit and user denials
---

A host can refuse a tool call before anyone is asked, as Claude's runtime does with deny rules: the policy answers `allow`, `ask` or `deny` per call, rules are data the harness evaluates against a tool's declared subject, a denial beats a hook's allow and a remembered approval, and every denial is recorded on the run and the outcome.

## What was built

- `code://packages/agents/src/types/agent.ts`, `agent/create-agent.ts`, `run/tools.ts` - `Policy.decide({ tool, input, run })` replaces `requireApproval`; hook first, then the policy; a policy `deny` wins over a hook allow and a remembered approval, `ask` over a hook allow (decision 119; task 01).
- `code://packages/agents/src/types/tool.ts`, `types/policy.ts`, `policy/rules.ts` - `ToolDefinition.subject?(input)`, `Rule { tool, match? }`, `rules({ allow, deny, ask, otherwise })` evaluated deny, ask, allow by list order with an anchored `*` / `?` glob on the subject (`matchGlob`), `DEFAULT_DECIDE` (decision 117; task 03).
- `code://packages/tools/src/shell.ts`, `files.ts` - `subject` on `shell_exec` (the command) and the five file tools (the path or pattern); `code://packages/papo/src/agent.ts` `policyOf` on `decide` (task 04).
- `code://packages/agents/src/types/store.ts`, `types/outcome.ts`, `types/turn.ts`, `run/tools.ts`, `run/turn.ts`, `run/run.ts`, `run/resume.ts`, `store/memory.ts`, `code://packages/store-file/src/store.ts` - `Denial { callId, name, input, reason, by }` with `by: policy | hook | user | invalid | limit`; `RunRecord.denials` required and `[]` from `runs.create`; `RunTally.denials?` on every outcome through `tally()`; the record written with the counters at every update, carried through `resume()`, filled `[]` for an old `run.json` (cli/03 F3; task 02).

## Verified

- `run/tools.test.ts` 20 (six precedence cases), `policy/rules.test.ts` 10, `run/denials.test.ts` 6, `create-agent.test.ts` 4, `contracts.test-d.ts` 18; the conformance suite's `denials` case on the memory and file stores; `@facio/tools` `files.test.ts` 8 and `shell.test.ts` 6 (one `subject` assertion per tool); papo `chat.test.ts` unchanged in behaviour under `ask | destructive | auto`.
- Full `pnpm check` green on 2026-09-16: 67 test files, 745 tests, no type errors.

## Departures from the plan

- papo's `policyOf` moved to `decide` in task 01 rather than task 04, so `@facio/papo` kept compiling while another session edited it.
- `matchGlob` is exported from the package next to `rules`, so a host can test a rule list against a subject with the same dialect.
- Task 02 reused the `tally()` agent/01-p5 task 07 introduced and its `RunTally` interface; `denials` is optional on the outcome (`RunTally.denials?`) and required on the record, as the task wrote.
- The user's deny of an approval records the request payload's input (validated, possibly edited), not the model's raw `call.input`.
- `packages/agents/src/run/tools.test.ts` and `packages/papo/src/turns.test.ts` each gained `denials` on a literal that builds the changed contract.

## Left for later

- papo's configuration gaining `permissions.rules` (allow, deny, ask lists) and the permission mode set (cli/03 F8): [cli/04-papo-harness-adoption](../../cli/04-papo-harness-adoption/plan.md) task 04.
- The glob dialect is narrower than Claude's per-tool matchers (the plan's Risks); a later decision may widen it.
- A dead run's refusals after its last `runs.update` are in the events only, the accepted loss the task named.
