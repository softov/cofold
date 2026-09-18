---
title: CLI-04 - papo adopts the harness's p5 and agent/04 - deferred
date: 2026-09-16
---

Left out on purpose or waiting on an answer; each has a home.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Claude's `plan` permission mode | a prompt-level mode there (an instruction not to edit plus `ExitPlanMode`), which needs the harness's commands; the user was offered "those four plus plan as default+instruction" on 2026-09-16 and chose the four alone (audited 2026-09-17) | a later cli plan, after agent/03 |
| Claude's `auto` mode | a model classifier behind a feature flag in Claude; left out by the assistant when it wrote the recommended option for F8 (2026-09-16), which the user chose; the user never asked to drop it (corrected 2026-09-17) | the user: offer it (as `bypassPermissions` less the questions, or over a classifier of our own) or leave it out |
| `alt+enter` to queue | `@textui/widgets`'s `TextArea` takes `alt+enter` as a newline before any binding sees it; not touching textui in cli/04 was the assistant's scope choice, never asked (audited 2026-09-17) | textui, if the user wants the key; the Queue chip and `/queue` stand in |
| `Turn.cost` and `/cost` in dollars | the plan's goal named `cost` among what papo adopts but no task step did; the harness records `RunRecord.cost` | a cli follow-up |
| a default allow for `memory_write` | under `default` a memory note now asks (it declares `writes`); Claude writes its own memory files unasked; a config or session allow rule restores it; never asked of the user (audited 2026-09-17) | the user; then papo's `BASE` |
| the `TurnPart` name `steer` | task 01 needed a part kind the plan did not name; the assistant chose `steer` and never asked (audited 2026-09-17) | the user, if another word is wanted |
| the config key `rules` next to `permissions` | the user chose where the lists live ("Config plus per-session setting", 2026-09-16); the key's name was the assistant's default (audited 2026-09-17) | the user; keep, erase or rename |
| a `cancelled` turn state on the Claude backend | its projection reads an interrupted turn as `complete` with the notice; the harness's reads `cancelled`; the contract asserts parts and outcome only | cli/03's projection |
| the terminal runs | papo against LM Studio (steer, stream, `/compact`, the modes, `--deny` on a real shell) and the real Claude CLI (cancel on a decision, the mode pass-through, `AskUserQuestion` under `bypassPermissions`) were not run in this session | the user, or the next session with a model at hand |
