---
title: 119 - A policy deny wins over the hook; a policy ask wins over a hook allow
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L5137 - "deny-rule overrides of hook allow/ask decisions"
  - code://packages/agents/src/run/tools.ts#L33-L56 - hook first, then the floor, then the remembered approval
  - code://packages/agents/src/run/tools.ts#L53-L54 - the remembered `alwaysApprove` (decision 63)
---

## Context

Once the policy can deny (cli/03 F3), the order between it, the `beforeTool` hook and a remembered approval has to be stated.
Claude evaluates deny rules above hook decisions and above session approvals; an ask rule forces the prompt.
The harness ran the hook first and let its decision stand (decision 46: a hook may escalate, never lower).

## Decision

Per call, after validation: the `beforeTool` hook runs first (it may modify the input the policy then judges); a hook `deny` or `stop` ends there.
Then `policy.decide` on the possibly modified input: `deny` wins over a hook `allow`, `modify` or `approval` and over a remembered approval; `ask` wins over a hook `allow`; `allow` leaves a hook's `approval` standing.
A remembered approval (`alwaysApprove`) skips only an `ask`.

Source: user, 2026-09-16, asked "Claude's order / Hook wins".

## Consequences

Decision 46 stays true and gains its mirror: the policy may refuse what a hook allowed.
`handleToolCall` restructures around one `decision` value; `tools.test.ts` gains the precedence cases.

## Options

"Hook wins" kept today's order and let a hook re-allow what a rule refused, which is what deny rules exist to prevent.
