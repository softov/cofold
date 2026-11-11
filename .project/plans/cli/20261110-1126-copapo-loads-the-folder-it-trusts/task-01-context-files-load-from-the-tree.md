---
title: Context files load from the tree
status: implemented
depends: []
layer: "store-file, copapo"
refs:
  - "[code://packages/copapo/src/chat.ts#L143-L149](../../../../packages/copapo/src/chat.ts#L143-L149) - `instructions()`, which this task replaces"
  - "[code://packages/store-file/src/skills.ts](../../../../packages/store-file/src/skills.ts) - the sibling disk reader whose shape `context.ts` copies"
  - https://code.claude.com/docs/en/memory - the load order and the `@path` rules
---

## Objective

copapo's system prompt is the configured instructions, then `~/.agents/AGENTS.md`, then `~/.cofold/AGENTS.md`, then one context file per folder from the filesystem root down to the workspace.
A folder's context file is its `AGENTS.md`, or its `CLAUDE.md` when it has no `AGENTS.md`, with its `@path` lines expanded.

## Files

- `CREATE: packages/store-file/src/context.ts` - `readContextFiles({ workspace, common })`: the files found, in load order, each with its path and expanded text.
- `CREATE: packages/store-file/src/context.test.ts` - the order, the `CLAUDE.md` fallback, imports, cycles, depth, code blocks.
- `UPDATE: packages/store-file/src/index.ts` - export `readContextFiles` and its types.
- `UPDATE: packages/copapo/src/chat.ts:143-149` - `instructions()` joins the configured text and each context file's text.
- `UPDATE: packages/copapo/src/chat.test.ts` - a workspace with a parent `AGENTS.md` and a child `CLAUDE.md` gives both, parent first.

## Steps

1. Write `readContextFiles` to walk from the workspace up to the filesystem root, collecting each folder's `AGENTS.md`, else its `CLAUDE.md`.
2. Put the `common` files first, in the order given, then the folders from the root down to the workspace.
3. Skip a file that is missing or empty, and read each path once.
4. Expand a word `@<path>` outside fenced and inline code, when the path names an existing file.
5. Resolve an import against its own file's folder, and append the imported text after that file.
6. Stop expanding at four levels, and expand a file once even when two files import it.
7. In copapo, pass `common: [~/.agents/AGENTS.md, <home>/AGENTS.md]`, where `home` is copapo's home.
8. Join the configured instructions and each file's text with a blank line, as `instructions()` does today.

## Validation

- `packages/store-file/src/context.test.ts`: the root-to-workspace order, and `CLAUDE.md` only where `AGENTS.md` is absent.
- The same file: a fenced import stays as text, a cycle stops, and the fifth level stays unread.
- `packages/copapo/src/chat.test.ts`: the system prompt holds the common file, then the parent, then the workspace file.
- `pnpm --filter @cofold/store-file typecheck` and `pnpm --filter @cofold/copapo typecheck` pass.

## Resume

Implemented 2026-11-10. `readContextFiles` and `importsOf` are in `packages/store-file/src/context.ts`.
`ChatOptions.agentsHome` names the common folder, `~/.agents` by default.
`testChat` points it at `/nowhere/.agents`, so the machine's own folder stays out of tests.
