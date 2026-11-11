---
title: Trust decides what a folder loads
status: implemented
depends: [task-02-skills-load-from-common-and-tree.md]
layer: "copapo"
refs:
  - "[code://packages/copapo/src/config.ts#L92-L94](../../../../packages/copapo/src/config.ts#L92-L94) - `loadConfig`, which reads `.copapo.json` only when trusted"
  - "[code://packages/copapo/src/config.ts#L144-L180](../../../../packages/copapo/src/config.ts#L144-L180) - `rememberConfig`, the pattern `saveTrust` copies"
  - "[code://packages/copapo/src/commands.ts#L126](../../../../packages/copapo/src/commands.ts#L126) - `openCopapo`, which reads trust before it builds the service"
---

## Objective

copapo knows, for each workspace, whether it is trusted, untrusted, or not asked yet, and which gated files it holds.
In a folder that is not trusted, copapo reads no `.copapo.json` and no project `.agents/skills`.
`copapo trust` saves the workspace's answer.

## Files

- `CREATE: packages/copapo/src/trust.ts` - `gatedFiles(workspace, backend)`, `trustOf({ workspace, env, backend })` and `saveTrust({ workspace, env, trusted })`.
- `CREATE: packages/copapo/src/trust.test.ts` - the closest answer wins, a project file's `trusted` is ignored, `projectTrust`, the gated files per backend.
- `UPDATE: packages/copapo/src/config.ts:24-90` - the schema takes `trusted` (folder to boolean) and `projectTrust` (`ask`, `always`, `never`; default `ask`).
- `UPDATE: packages/copapo/src/config.ts:92-94` - `loadConfig({ ..., trusted })` passes `project: '.copapo.json'` only when `trusted` is `true`.
- `UPDATE: packages/copapo/src/types/config.ts` - `trusted` and `projectTrust` on `CopapoConfig`.
- `UPDATE: packages/copapo/src/chat.ts:84` - the home skill source's `project` is the service's trust.
- `UPDATE: packages/copapo/src/commands.ts:126` - `openCopapo` reads `trustOf`, keeps it on `Copapo.trust`, and passes it to `loadConfig` and the chat.
- `UPDATE: packages/copapo/src/commands.ts` - a `trust` action in the `setup` group: `copapo trust` saves yes, `copapo trust --no` saves no, both print the folder and the file written.
- `UPDATE: packages/copapo/src/commands.test.ts` - `copapo trust` writes the user file; a later open reads `.copapo.json`.

## Steps

1. Write `gatedFiles` to find `.copapo.json` up the tree and `.agents/skills` up to the repository root.
2. Add `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json` in the workspace when the backend is `claude`.
3. Write `trustOf` to read `trusted` and `projectTrust` from the user file layer only, through `resolveConfig(...).layers`.
4. Compare folders by their real path, and without case on Windows.
5. Return `trusted` or `untrusted` from the closest saved answer for the workspace or a folder above it.
6. With no saved answer and no gated file, return `trusted`, because there is nothing to gate.
7. With no saved answer and a gated file, return `unasked`, with the gated files.
8. Write `saveTrust` to set `trusted[<real path>]` in the user file, as `rememberConfig` writes a key.
9. In `openCopapo`, read `unasked` by `projectTrust`: `always` loads the project, `ask` and `never` load nothing.
10. Let a front pass its own answer to `openCopapo`, so the screen and ACP ask first.
11. Add the `trust` action with `--no`, and a description that names the user file.

## Validation

- `packages/copapo/src/trust.test.ts`: every step's case, with a temporary `XDG_CONFIG_HOME`.
- `packages/copapo/src/commands.test.ts`: after `copapo trust`, the providers list shows a provider from `.copapo.json`; before, it does not.
- `pnpm --filter @cofold/copapo typecheck` passes.

## Resume

Implemented 2026-11-10. `trust.ts` holds `gatedFiles`, `trustOf`, `loadsProject` and `saveTrust`. `openCopapo(globals, { trusted })` takes a front's answer. The backend is read before trust, from every file but the project's. The schema types `trusted` as an object, since cofold's `JsonSchema` takes no schema in `additionalProperties`; `trustOf` skips a value that is not a boolean.
