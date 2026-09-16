---
title: AGENT-04 - Policy rules: allow, ask or deny per tool call, recorded on the run
domain: agent
status: planned
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core/plan.md
decisions:
  - decisions/policy-decides-allow-ask-deny.md
  - decisions/rules-are-harness-data.md
  - decisions/run-record-denials.md
  - decisions/policy-deny-overrides-hook.md
  - decisions/no-anthropic-api-adapter.md
refs:
  - code://.project/plans/cli/03-papo-claude/plan.md#L94-L104 - the papo contra-validation findings; F3 is this plan (Claude's runtime is the reference, cli/03 decision 10)
  - code://.project/plans/cli/03-papo-claude/deferred.md#L14 - routes F3 to "a policy plan"
  - code://packages/agents/src/types/agent.ts#L27-L33 - `Policy { requireApproval }`, the floor being replaced
  - code://packages/agents/src/agent/create-agent.ts#L15-L17,L68 - `DEFAULT_POLICY` and how options merge over it
  - code://packages/agents/src/run/tools.ts#L14-L58 - `handleToolCall`: validate, hook, floor, remembered approval, `executeTool`
  - code://packages/agents/src/run/tools.ts#L16-L19 - the `deny` helper: `tool.denied` event plus an error tool result
  - code://packages/agents/src/run/turn.ts#L259-L263 - the `max_tool_calls` denial in `processCalls`
  - code://packages/agents/src/run/turn.ts#L304-L307 - a user's `deny` of an approval becomes an error result (decision 76)
  - code://packages/agents/src/run/turn.ts#L308-L319 - a declined input request
  - code://packages/agents/src/types/store.ts#L30-L44,L147 - `RunRecord` and `runs.update`, where `denials` goes
  - code://packages/agents/src/store/memory.ts#L119-L130 - `update` copies the counters; the file store does the same at `store-file/src/store.ts:160-171`
  - code://packages/agents/src/testing/store-conformance.ts#L176-L190 - the `update` cases every store must pass
  - code://packages/agents/src/types/tool.ts#L31-L53 - `ToolDefinition` / `Tool`; `subject` is added
  - code://packages/agents/src/tool/create-tool.ts - `createTool` copies definition slots onto the frozen tool; `subject` follows `effects`
  - code://packages/tools/src/shell.ts#L40-L52 - `shell_exec` (`effects.destructive`), subject: the command
  - code://packages/tools/src/files.ts#L47-L153 - `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, subject: the path
  - code://packages/papo/src/agent.ts#L33-L39 - `policyOf(mode)`, the one `requireApproval` consumer outside the harness
  - code://packages/agents/src/agent/create-agent.test.ts#L49-L88 - the tests that read `requireApproval`
  - code://packages/agents/src/run/tools.test.ts#L115-L118 - the test that stubs it
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2310-L2403 - Claude's `PermissionBehavior`, `PermissionRuleValue { toolName, ruleContent? }`, `PermissionUpdate`, `PermissionUpdateDestination`
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L5130-L5138 - `SDKPermissionDenial`, `result.permission_denials` "the authoritative record", deny rules overriding hook decisions
---

## Goal

A host can refuse a tool call before anyone is asked, as Claude's runtime does with deny rules: the policy answers `allow`, `ask` or `deny` per call, rules are data the harness evaluates against what a tool declares as its subject, a denial beats a hook's allow and a remembered approval, and every denial is recorded on the run.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "requireApproval" packages/*/src` - the contract, its default, the one call in `tools.ts`, papo's `policyOf`, two test files.
- `rg -n "deny\(|tool.denied" packages/agents/src/run` - five denial paths: unknown tool, arguments not JSON, schema failure, hook deny, `max_tool_calls`; plus the user's deny (`approval.resolved`) and the declined input, which write no `tool.denied`.
- `rg -n "subject|ruleContent" packages/agents/src packages/tools/src` - nothing; the slot and the rule shape are new.
- `rg -n "permission_denials|PermissionRuleValue" packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - the reference shapes.

### Runtime path

```
handleToolCall(deps, call)
  validate → beforeTool hook (deny / stop end here; modify changes input)
  → policy.decide({ tool, input, run })                         decisions 116, 119
      deny  → record Denial { by: 'policy' } + tool.denied + error result
      ask   → remembered approval? execute : { kind: 'approval' }
      allow → hook asked approval? that path : executeTool
processCalls: max_tool_calls → Denial { by: 'limit' }; applyResolved: user deny / declined → Denial { by: 'user' }
every Denial → ctx.counters.denials.push(...) → runs.update({ denials }) with the counters → outcome.denials   decision 118
rules({ allow, deny, ask, otherwise }) → Policy: first matching rule by list order deny, ask, allow; match on tool name and tool.subject(input)   decision 117
```

### Gaps

- `Not found: any refusal that is not a hook` - `policy` can only require approval.
- `Not found: a record of denials on the run` - only `tool.denied` events and error results.
- `Not found: a rule shape or a tool's subject` - the harness and `@facio/tools` have neither.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| [116](../../../decisions/policy-decides-allow-ask-deny.md) | `Policy.decide({ tool, input, run }) => { behavior: 'allow' \| 'ask' \| 'deny'; reason? }` replaces `requireApproval`; default: `ask` when `effects.destructive`, else `allow` | User (2026-09-16) |
| [117](../../../decisions/rules-are-harness-data.md) | `rules({ allow?, deny?, ask?, otherwise? })` builds a `Policy`; `Rule = { tool, match? }`; `ToolDefinition.subject?(input) => string`; `@facio/tools` declares subjects | User (2026-09-16) |
| [118](../../../decisions/run-record-denials.md) | `RunRecord.denials: Denial[]` and `denials?` on every outcome; `by: 'policy' \| 'hook' \| 'user' \| 'invalid' \| 'limit'` | User (2026-09-16); `user` defaulted in the file |
| [119](../../../decisions/policy-deny-overrides-hook.md) | Hook first; a policy `deny` wins over hook allow/modify/approval and over a remembered approval; `ask` wins over a hook allow; the remembered approval skips only an `ask` | User (2026-09-16) |
| [112](../../../decisions/no-anthropic-api-adapter.md) | This plan exists because papo's contra-validation found F3; Claude is the reference, never a dependency | User (2026-09-16) |

## Proposed architecture

- **Data flow** - `handleToolCall` computes one `decision` after the hook; `deny` short-circuits into the `deny` helper with `by: 'policy'`; `ask` becomes the approval pause unless remembered; `allow` executes. `rules()` is a pure function over `Rule[]` lists and the tool's `subject(input)`.
- **State flow** - `TurnContext.counters.denials: Denial[]`; every denial pushes; `finishRun`, `pause` and `resume`'s `countersOf` carry it through `runs.update({ denials })` and the record.
- **Layer responsibilities** - `@facio/agents`: contract, default policy, `rules()`, the record · `@facio/tools`: `subject` on its tools · `@facio/papo`: `policyOf` moved to `decide` (rule lists in papo's config are a `cli` plan).
- **Source-of-truth files** - `code://packages/agents/src/types/agent.ts` (`Policy`, `PolicyDecision`), `code://packages/agents/src/types/tool.ts` (`subject`), `code://packages/agents/src/types/store.ts` (`Denial`, `RunRecord.denials`), `code://packages/agents/src/policy/rules.ts` (new).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - decide() and the precedence](task-01-decide-and-precedence.md) | todo | - |
| [02 - Denials on the run record](task-02-denials-record.md) | todo | 01 |
| [03 - rules() and Tool.subject](task-03-rules-and-subject.md) | todo | 01 |
| [04 - Subjects on @facio/tools; papo's policyOf](task-04-tools-subjects-papo-policy.md) | todo | 03 |

## Risks and tradeoffs

- `requireApproval` is removed, not deprecated: one contract, one method (facio's no-boilerplate rule); the three consumers move in the same change.
- The glob dialect (`*`, `?`, anchored) is narrower than Claude's per-tool matchers; a rule that needs more (a path under a directory) is written with `*` today. Reversible by a later decision.
- `denials` is written as a whole list on each update; a run with hundreds of denials rewrites the list each time. Accepted: denials are rare and the record is small.

## Resume state

- **Done so far:** planned 2026-09-16; decisions 116-119 as files.
- **Next action:** [task-01-decide-and-precedence.md](task-01-decide-and-precedence.md).
- **Open questions:** none.
- **Watch out for:** papo's config gaining `permissions.rules` (allow/deny/ask lists) is a `cli` plan, not this one; the ahpd findings (cancel denies the pending approval; the compaction notice carries before and after tokens) are not in any plan yet.

## Final verification checklist

- [ ] `pnpm check` green.
- [ ] A `deny` decision refuses a call a `beforeTool` hook allowed, and one the session had remembered as always-approved.
- [ ] `rules({ deny: [{ tool: 'shell_exec', match: 'rm *' }] })` refuses `rm -rf /` and lets `ls` through; a tool without `subject` matches on name only.
- [ ] `RunRecord.denials` lists every denial of a run with its `by`; the outcome carries the same list; `resume()` keeps it.
- [ ] papo over `@facio/agents` with `permissions: ask | destructive | auto` behaves as before.
- [ ] `plans/index.md` updated.
