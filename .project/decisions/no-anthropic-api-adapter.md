---
title: 112 - Claude contra-validates the harness through papo; the harness never calls the Claude API
status: accepted
date: 2026-09-16
refs:
  - code://.project/plans/cli/03-papo-claude/plan.md#L94-L110 - the contra-validation and its findings table
  - code://.project/plans/cli/03-papo-claude/deferred.md#L14 - where each finding goes
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-08-second-adapter.md - the former "Anthropic Messages API adapter" outline, now the findings task
---

## Context

A p5 outline written by an earlier session proposed `@facio/model-anthropic`, a Messages API adapter, "to prove the contract is not shaped by Chat Completions".
The user's intent, stated since the beginning and repeated on 2026-09-16, is the opposite: Claude is only there to contra-validate the harness's features, through papo running the same program on the Claude Agent SDK (cli/03).

## Decision

No Anthropic API adapter and no `@facio/model-anthropic`.
Claude's runtime is the reference the harness is checked against; every difference found through papo or ahpd is a finding presumed to be the harness's bug, recorded in cli/03's findings table and fixed in a plan task.
A finding is not a decision: it gets no decision file, and code and plans cite it by number (`cli/03 F2`).

Source: user, 2026-09-16: "the intent to use claude is just to contravalidate the features", "It's not supposed to be an API call"; on the former decision 114 (a caller-supplied message id, since removed): "it's not a decision, it's a defect, something we did not support".

## Consequences

Any future "second adapter" is a Chat Completions-compatible endpoint or a provider the user names.
The contract's independence from Chat Completions is proven by the findings, not by a Claude client.
