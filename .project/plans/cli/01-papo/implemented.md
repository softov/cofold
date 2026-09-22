---
title: papo - implemented
date: 2026-09-16
refs:
  - git://3efef91 - settings on the session
  - git://711f502 - opening never waits on the network
  - git://222d18d - the shell verified against a real server
  - code://packages/papo/src/chat.ts - createChat, the service both fronts use
  - code://packages/papo/src/turns.ts - the store projected to turns
  - code://packages/papo/src/commands.ts - the shell actions
  - code://packages/papo/src/screen/app.tsx - the textui application
---

`papo` talks to the harness in this process: a screen drawn with `@textui/chat` and a shell of `@doopx/commands` actions over the same sessions on disk under `~/.doopx`.

## What was built

- The service (say, wait, approve, deny, answer, cancel, sessions, snapshot, settings, configure), the projection to turns and to the chat components' props, the shell, the binary, the screen.

## Verified

- `chat.test.ts`, `commands.test.ts`, `turns.test.ts`, `screen/screen.test.tsx`; the shell against a real model server on 2026-09-16.

## Departures from the plan

- none recorded.

## Left for later

- The manual run of the screen against a model server with `@doopx/tools` on (the server was unreachable on 2026-09-16).
