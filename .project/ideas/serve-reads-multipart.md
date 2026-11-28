---
title: The HTTP surface reads multipart uploads
created: 2026-11-28
refs:
  - "[code://packages/remote/src/serve.ts#L205-L209](../../packages/remote/src/serve.ts#L205-L209) - readBody, which accepts only application/json and answers 415"
---

The HTTP surface in `serve.ts` reads only JSON bodies.
After [A command uploads a file](../briefs/a-command-uploads-a-file.md), a command with a file is not an HTTP route.
`serve.ts` could also read `multipart/form-data`, so that `s2cmd serve` exposes those commands too.
Then a command with a file is on every surface, as every other command is.
