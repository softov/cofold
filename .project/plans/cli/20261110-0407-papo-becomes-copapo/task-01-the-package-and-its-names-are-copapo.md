---
title: The package and its names are copapo
status: implemented
depends: []
layer: "copapo"
refs:
  - "[code://packages/copapo/src/config.ts#L86-L128](../../../../packages/copapo/src/config.ts#L86-L128) - the resolver name, the project file, the env variables"
  - "[code://packages/copapo/src/agent.ts#L9](../../../../packages/copapo/src/agent.ts#L9) - `AGENT_ID`"
  - "[code://packages/copapo/src/chat.ts#L63-L66](../../../../packages/copapo/src/chat.ts#L63-L66) - `settingsKey`"
---

## Objective

`packages/copapo` is `@cofold/copapo` with the binary `copapo`, and it reads, writes and prints only copapo names.

## Files

- `UPDATE: packages/papo` - moved to `packages/copapo` with `git mv`.
- `UPDATE: packages/copapo/package.json` - name `@cofold/copapo`, binary `copapo`, description, `repository.directory`.
- `UPDATE: packages/copapo/src/config.ts` - resolver name `copapo`, project `.copapo.json`, `COPAPO_*`, the user file `~/.config/copapo/config.json`.
- `UPDATE: packages/copapo/src/agent.ts:9` - `AGENT_ID` is `copapo`.
- `UPDATE: packages/copapo/src/chat.ts:63-66` - `settingsKey` is `copapo/session/<id>/settings`.
- `UPDATE: packages/copapo/src/commands.ts` - `COPAPO_WORKSPACE`, the provider name, the examples and the sentences.
- `UPDATE: packages/copapo/src/program.ts` - the program name `copapo`.
- `UPDATE: packages/copapo/src/export.ts:40` - the file is `copapo-<session>.md`.
- `UPDATE: packages/copapo/src/screen/state.ts` - the binding paths under `$/copapo/`.
- `UPDATE: packages/copapo/src/types/config.ts` - `PapoConfig` becomes `CopapoConfig`.
- `UPDATE: packages/copapo/README.md` - every name.
- `UPDATE: packages/copapo/skills` - every name in the shipped skills.
- `UPDATE: packages/copapo/src` - every other identifier, comment and test that names papo.

## Steps

1. Run `git mv packages/papo packages/copapo`.
2. Rename the package, the binary and the program name.
3. Rename the config resolver name, the project file and every `PAPO_` variable to `COPAPO_`.
4. Rename `AGENT_ID`, `settingsKey`, the export file name and the screen's binding paths.
5. Rename the identifiers that hold papo, such as `PapoConfig`, `Papo`, `openPapo` and `createPapoRegistry`.
6. Rename papo in the comments, the sentences, the README and the skills.
7. Run `rg -i papo packages/copapo --glob '!node_modules' --glob '!dist'` and fix what it finds.

## Validation

- `config.test.ts` reads `.copapo.json` and `COPAPO_MODEL`, and ignores `.papo.json` and `PAPO_MODEL`.
- `pnpm --filter @cofold/copapo typecheck` and the package's tests are green.
- `node packages/copapo/dist/main.js --help` prints `copapo`.

## Resume
Implemented 2026-11-10. `git mv` kept the history of every file.
A test in `config.test.ts` checks that the papo files and `PAPO_*` variables are not read.
`pnpm --filter @cofold/copapo typecheck` is green, and the package's 8 test files and 152 tests pass.
