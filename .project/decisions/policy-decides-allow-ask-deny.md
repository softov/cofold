---
title: 116 - The policy decides allow, ask or deny per tool call
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/agent.ts#L27-L33 - `Policy.requireApproval(): boolean`, the floor being replaced
  - code://packages/agents/src/agent/create-agent.ts#L15-L17 - `DEFAULT_POLICY`: ask when `effects.destructive`
  - code://packages/agents/src/run/tools.ts#L51-L56 - where the floor is consulted today
  - code://packages/papo/src/agent.ts#L33-L39 - papo's `policyOf(mode)`, the one consumer to move
  - code://.project/plans/cli/03-papo-claude/plan.md#L101 - finding F3: Claude refuses a tool before asking; ours has no deny
---

## Context

Claude's runtime answers every tool call with one of three behaviors, `allow`, `deny` or `ask`, from rules and the permission mode.
The harness's policy floor (decision 46) can only say whether approval is needed; a refusal has to be a hook, and a host without hooks cannot refuse anything.
Finding F3 of the papo contra-validation (cli/03) named the gap.

## Decision

`Policy.decide({ tool, input, run }) => PolicyDecision | Promise<PolicyDecision>` with `PolicyDecision = { behavior: 'allow' | 'ask' | 'deny'; reason?: string }` replaces `Policy.requireApproval`.
The default policy answers `ask` when `tool.effects.destructive` is true and `allow` otherwise; papo's `policyOf` maps `ask` / `auto` / `destructive` onto it.

Source: user, 2026-09-16, asked "Three-way decide() (Claude) / Add deny() beside requireApproval()".

## Consequences

A host refuses a call without a hook; a denial has a reason the model and the person read.
`requireApproval` disappears from the contract: `create-agent.test.ts`, `tools.test.ts` and papo's `policyOf` move to `decide`.
Precedence against the hook is [policy-deny-overrides-hook](policy-deny-overrides-hook.md); the record is [run-record-denials](run-record-denials.md).

## Options

Adding `deny?()` beside `requireApproval()` kept the boolean and avoided the break, but two methods answering one question is the boilerplate facio avoids.
