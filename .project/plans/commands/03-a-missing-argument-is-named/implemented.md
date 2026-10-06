---
title: A command typed without its required argument says which argument it needs - implemented
date: 2026-10-06
refs:
  - git://16d3264
  - npm://@cofold/terminal@0.3.0 - the release that carries it
  - "[code://packages/terminal/src/program.ts](../../../../packages/terminal/src/program.ts) - the branch before `unknown command`"
---

A command typed without its required argument names the argument and prints its usage, exit 2, instead of answering `unknown command`.

## What was built

- [`code://packages/terminal/src/program.ts`](../../../../packages/terminal/src/program.ts) - the first visible command whose literal words match names its first required slot.

## Verified

- [`code://packages/terminal/src/program.test.ts`](../../../../packages/terminal/src/program.test.ts) - four cases; `pnpm check` 886 tests.
- 2026-10-06: a CLI built by `commandsFrom` over petshop's served manifest answered `"pet show" needs id.` with its usage, exit 2.

## Departures from the plan

- None.

## Left for later

- Nothing; ahpd daemon 09 task 03 takes it when the server moves to this release.
