---
title: 112 - Claude contra-validates the harness through papo; the harness never calls the Claude API
status: accepted
date: 2026-09-16
refs:
  - code://.project/plans/cli/03-papo-claude/plan.md#L94-L104 - the contra-validation and its five findings
  - code://.project/plans/cli/03-papo-claude/deferred.md#L14 - F1, F2, F4 routed to agent/01-p5; F3 to a policy plan
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-08-second-adapter.md - the former "Anthropic Messages API adapter" outline, now the F1, F2, F4 task
---

## Context

A p5 outline written by an earlier session proposed `@facio/model-anthropic`, a Messages API adapter, "to prove the contract is not shaped by Chat Completions".
The user's intent, stated since the beginning and repeated on 2026-09-16, is the opposite: Claude is only there to contra-validate the harness's features, through papo running the same program on the Claude Agent SDK (cli/03); the harness must never be a Claude API call, and no package may exist only to make Claude callable.

## Decision

No Anthropic API adapter and no `@facio/model-anthropic`. Claude's runtime is the reference the harness is checked against; every difference found through papo is a finding presumed to be the harness's bug.
p5 task 08 is the harness side of that contra-validation: findings F1, F2, F4. F3 (deny rules) is plan agent/04.

Source: user, 2026-09-16: "the intent to use claude is just to contravalidate the features", "It's not supposed to be an API call".

## Consequences

Any future "second adapter" is a Chat Completions-compatible endpoint or a provider the user names; the contract's independence from Chat Completions is proven by the findings, not by a Claude client.
