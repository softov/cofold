---
title: papo slash commands - implemented
date: 2026-09-16
refs:
  - git://e58a906 - export, usage on turns, shipped skills
  - git://7b6beec - the commands and the overlay
  - code://packages/papo/src/screen/app.tsx - the client commands
  - code://packages/papo/src/screen/info.tsx - the overlay
  - code://packages/papo/src/export.ts - toMarkdown
  - code://packages/papo/skills - init and review
---

The `/` menu in papo's composer lists the skills and the palette commands; `/status`, `/cost`, `/skill`, `/memory`, `/export`, `/retry`, `/clear`, `/theme`, `/config`, `/help` exist as client commands with an overlay; `/init` and `/review` ship as skills.

## What was built

- The commands and the overlay, `Turn.usage` and `Turn.steps`, the Markdown export, the shipped skills.

## Verified

- `screen/screen.test.tsx`, `commands.test.ts`, `chat.test.ts`.

## Departures from the plan

- The plan itself was wrong: the commands that belong to the runtime (`/status`, `/cost`, `/config`, `/skills`, `/compact`, `/autocompact`) were built in the client. They move to the runtime in [agent/03](../../agent/03-slash-commands/plan.md), which supersedes this plan for them.

## Left for later

- See [deferred.md](deferred.md).
