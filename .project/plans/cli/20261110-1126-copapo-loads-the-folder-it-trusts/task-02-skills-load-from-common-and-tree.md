---
title: Skills load from the common folders and the tree
status: implemented
depends: []
layer: "store-file, copapo"
refs:
  - "[code://packages/store-file/src/skills.ts#L13-L31](../../../../packages/store-file/src/skills.ts#L13-L31) - `fileSkillSource`, which gains two options"
  - "[code://packages/copapo/src/chat.ts#L48-L53](../../../../packages/copapo/src/chat.ts#L48-L53) - `shippedSkills()`, which uses the new option instead of its wrapper"
  - "[code://packages/copapo/src/chat.ts#L84](../../../../packages/copapo/src/chat.ts#L84) - the sources, in clash order"
---

## Objective

copapo lists skills from `~/.cofold/skills`, then `~/.agents/skills`, then the skills it ships.
The project's `.agents/skills` folders, from the workspace up to the repository root, come first, nearest folder first.
A source can leave the project out, so task 03 can gate it.

## Files

- `UPDATE: packages/store-file/src/skills.ts:13-31` - `fileSkillSource({ root, project?, walk? })`: `project` (default `true`) says whether project folders are read; `walk` (default `false`) reads `.agents/skills` up to the repository root.
- `UPDATE: packages/store-file/src/skills.test.ts` - `project: false` reads only `<root>/skills`; `walk: true` reads a parent's `.agents/skills` and stops at the folder that holds `.git`.
- `UPDATE: packages/copapo/src/chat.ts:48-53` - `shippedSkills()` becomes `fileSkillSource({ root: SHIPPED_ROOT, project: false })`.
- `UPDATE: packages/copapo/src/chat.ts:84` - the sources: home with `walk: true`, then `~/.agents` with `project: false`, then the shipped skills.
- `UPDATE: packages/copapo/src/chat.test.ts` - a skill in a parent's `.agents/skills` is listed once; a skill in both `~/.cofold/skills` and `~/.agents/skills` lists the `~/.cofold` one.

## Steps

1. Add `project` to `fileSkillSource`, and read no workspace folder when it is `false`.
2. Add `walk`: read `.agents/skills` in the workspace and each parent, up to the first folder with `.git`.
3. Without a `.git` folder above the workspace, read the workspace folder only, as today.
4. Keep the nearest folder first, so a nearer skill shadows a farther one of the same name.
5. Give the `project` option a function form, `() => boolean`, so task 03 can decide per call.
6. In copapo, read `~/.agents` from `os.homedir()`, and leave `COFOLD_HOME` as copapo's home.
7. Keep the defaults equal to today's behaviour for every other caller.

## Validation

- `packages/store-file/src/skills.test.ts`: the two options and their defaults.
- `packages/copapo/src/chat.test.ts`: the clash order and the walked folder.
- `pnpm --filter @cofold/store-file typecheck` and `pnpm --filter @cofold/copapo typecheck` pass.

## Resume

Implemented 2026-11-10. Found: when the home folder is a repository, the walk reached `~/.agents/skills` as a project folder. The home folder's `.agents/skills` is never a project folder, in `fileSkillSource` and in `gatedFiles`.
