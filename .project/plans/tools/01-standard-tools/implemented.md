---
title: The standard tools - implemented
date: 2026-09-16
refs:
  - git://089bf5c - files
  - git://5bca52c - shell
  - git://729bc51 - web
  - git://db41bca - memory
  - git://5963c3d - papo turns them on
  - code://packages/tools/src/files.ts - read_file, write_file, edit_file, list_files, search_files; resolveWithin, displayPath
  - code://packages/tools/src/shell.ts - shell_exec; the kill reaches the process tree
  - code://packages/tools/src/web.ts - web_fetch (htmlToText), web_search over brave, tavily, duckduckgo
  - code://packages/tools/src/memory.ts - memory_read, memory_write under <home>/memory/<workspace slug>/
  - code://packages/papo/src/agent.ts - capabilitiesOf(config.tools)
---

`@doopx/tools` gives every agent the tools it needs to work in a repository, as capabilities: `files()`, `shell()`, `web({ search })`, `memory({ dir })`; papo turns them on from `config.tools`.

## What was built

- The four capabilities and papo's wiring.

## Verified

- 22 tests in `packages/tools`; papo's `chat.test.ts` runs `read_file` and `shell_exec` under `destructive` and `auto`.

## Departures from the plan

- none recorded.

## Left for later

- A manual turn against a model server with the tools on (the server was unreachable on 2026-09-16).
