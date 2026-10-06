---
title: The web and memory tools name their subject
status: todo
depends: []
layer: "tools"
refs:
  - "[code://packages/tools/src/web.ts#L35-L48](../../../../packages/tools/src/web.ts#L35-L48) - `web_fetch`"
  - "[code://packages/tools/src/web.ts#L76-L89](../../../../packages/tools/src/web.ts#L76-L89) - `web_search`"
  - "[code://packages/tools/src/memory.ts#L38-L78](../../../../packages/tools/src/memory.ts#L38-L78) - `memory_read`, `memory_write`, and `inside`, the memory folder's path check"
  - "[code://packages/tools/src/paths.ts](../../../../packages/tools/src/paths.ts) - `displayPath`, relative with forward slashes under a folder"
---

## Objective

`web_fetch` names the URL, `web_search` the query, and `memory_read` and `memory_write` the file relative to the memory folder, so a permission rule's `match` and an event reader see what each call acts on.

## Files

- `UPDATE: packages/tools/src/web.ts:35-48,76-89` - `subject: (input) => input.url` and `subject: (input) => input.query`.
- `UPDATE: packages/tools/src/memory.ts:38-78` - `subject: (input) => displayPath(dir, resolveWithin(dir, input.path ?? INDEX).absolute)` on both tools.
- `UPDATE: packages/tools/src/web.test.ts`, `packages/tools/src/memory.test.ts` - the cases below.

## Steps

1. Tests first.
2. Add the four subjects; a memory path outside the folder still shows as an absolute path in the subject, and `execute` still refuses it.

## Validation

- `web_fetch.subject({ url: 'https://a.example/x' })` is `https://a.example/x`; `web_search.subject({ query: 'q' })` is `q`.
- `memory_read.subject({})` is `MEMORY.md`; `memory_write.subject({ path: 'notes/a.md', content: '' })` is `notes/a.md`; `'../x.md'` gives an absolute path.
- `rules({ deny: [{ tool: 'web_fetch', match: 'https://a.example/*' }] })` denies that fetch.
- `pnpm --filter @cofold/tools test` is clean.

## Resume

