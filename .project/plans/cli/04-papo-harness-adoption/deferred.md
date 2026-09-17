---
title: CLI-04 - papo adopts the harness's p5 and agent/04 - deferred
date: 2026-09-16
---

Left out on purpose or waiting on an answer; each has a home.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Claude's `plan` permission mode | a prompt-level mode there (an instruction not to edit plus `ExitPlanMode`), which needs the harness's commands | a later cli plan, after agent/03 |
| Claude's `auto` mode | a model classifier behind a feature flag; the user did not want it offered | unplanned |
| `alt+enter` to queue | `@textui/widgets`'s `TextArea` takes `alt+enter` as a newline before any binding sees it, and textui is not modified here | textui, if a binding hook is wanted; the Queue chip and `/queue` stand in |
| `Turn.cost` and `/cost` in dollars | the plan's goal named `cost` among what papo adopts but no task step did; the harness records `RunRecord.cost` | a cli follow-up |
| a default allow for `memory_write` | under `default` a memory note now asks (it declares `writes`); Claude writes its own memory files unasked; a config or session allow rule restores it, whether papo should ship that by default is the user's call | the user; then papo's `BASE` |
| the `TurnPart` name `steer` | task 01 needed a part kind the plan did not name; the user has not confirmed the word | the user |
| the config key `rules` next to `permissions` | CLI-04.5 wrote `permissions.rules`; `permissions` is the mode string, so the sibling key was defaulted | the user; erase or rename |
| a `cancelled` turn state on the Claude backend | its projection reads an interrupted turn as `complete` with the notice; the harness's reads `cancelled`; the contract asserts parts and outcome only | cli/03's projection |
| the terminal runs | papo against LM Studio (steer, stream, `/compact`, the modes, `--deny` on a real shell) and the real Claude CLI (cancel on a decision, the mode pass-through, `AskUserQuestion` under `bypassPermissions`) were not run in this session | the user, or the next session with a model at hand |
