---
title: An empty model is "unset", and what a person chooses is written back into the configuration
status: done
depends: []
layer: papo
refs:
  - code://packages/papo/src/chat.ts#L96-L107 - `checkSettings` (step 1, built: `''` accepted)
  - code://packages/papo/src/chat.ts#L242-L250 - `patchSettings(sessionId, patch)` (step 1, built: `model: ''` removes the session's own model)
  - code://packages/papo/src/chat.ts#L51,L74-L86 - `defaultModel` and `modelRef()`; the cache must not hide a `config.model` changed after start
  - code://packages/papo/src/config.ts#L126-L158 - `loadConfig`; `rememberConfig` sits next to it and resolves the same layers
  - code://packages/config/src/index.ts#L75-L137 - `resolveConfig`: `layers[].kind` (`base | user | project | environment | explicit`) and `sourceOf(field)`
  - code://packages/papo/src/commands.ts#L84-L115 - `Papo` and `openPapo`, where `remember` is built with the same `cwd` / `path`
  - code://packages/papo/src/commands.ts#L24-L38,L150-L190,L367-L389 - `settingsPatch`, `say`, `session.set`: the shell's callers
  - code://packages/papo/src/screen/app.tsx#L189-L202 - `controller.configure`: the chips' caller
  - code://packages/papo/src/types/config.ts - `PapoConfig`, where `RememberedSettings` is typed
---

## Objective

A new conversation started from the screen with no configured model works (built), and every model, permission mode or thinking level a person chooses becomes the configuration's default for the next new conversation ([CLI-05.1](../../../decisions/papo-remembers-picks-in-config.md)).

## Files

- `UPDATE: packages/papo/src/chat.ts:96-107,242-250` - built: `checkSettings` accepts `''`; `patchSettings` deletes `model` on `''`; `say` and `configure` use it.
- `UPDATE: packages/papo/src/chat.test.ts` - built: the "starts from the configured defaults" case sends `model: ''` on a new conversation.
- `UPDATE: packages/papo/src/chat.ts:51,74-86` - `modelRef()` returns `config.model` when set, reading it each time; the cache keeps only the listed answer.
- `UPDATE: packages/papo/src/types/config.ts` - `RememberedSettings = Partial<Pick<Settings, 'model' | 'permissions' | 'reasoning'>>` (import `Settings` from `./settings.js`).
- `UPDATE: packages/papo/src/config.ts` - `rememberConfig(args)`, `userConfigPath(env, home?)`, `indentOf(text)`.
- `CREATE: packages/papo/src/config-remember.test.ts` (or cases in `config.test.ts`) - the write.
- `UPDATE: packages/papo/src/commands.ts:84-115` - `Papo.remember(patch): Promise<string[]>`; `openPapo` builds it; `redactedConfig` unchanged.
- `UPDATE: packages/papo/src/commands.ts` - `say` (new session) and `session.set` call `papo.remember(rememberedOf(patch))` after the session write succeeds.
- `UPDATE: packages/papo/src/screen/app.tsx:189-202` - `controller.configure` calls `papo.remember(rememberedOf(patch))` after the store/kv write; a failure is `report`ed and does not undo the session's setting.
- `UPDATE: packages/papo/src/commands.test.ts`, `screen/screen.test.ts` - the shell and the chip write the file.
- `UPDATE: packages/papo/README.md` - the configuration section: papo writes `model`, `permissions`, `reasoning` when chosen.

## Steps

1. Built (2026-09-16, before this plan): `checkSettings` lets `model: ''` through; `patchSettings` removes the session's own `model` on `''`; test in `chat.test.ts`.

2. `config.ts`:

   ```ts
   /** The fields a person's choice is written back as (decision CLI-05.1). */
   export type RememberedSettings = Partial<Pick<Settings, 'model' | 'permissions' | 'reasoning'>>;   // in types/config.ts

   /** `~/.config/papo/config.json`, `$XDG_CONFIG_HOME` honoured: where a field no file sets is written. */
   export function userConfigPath(env: NodeJS.ProcessEnv, home = homedir()): string {
     return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'papo', 'config.json');
   }

   /** The indentation a JSON file uses (its first indented line), two spaces when it has none. */
   export function indentOf(text: string): string

   /**
    * Writes each field of `patch` into the file that currently sets it, else the user file (decision CLI-05.1).
    * `model: ''` is skipped (unset is not a choice). Returns the files written, in order.
    */
   export async function rememberConfig(args: { cwd: string; env?: NodeJS.ProcessEnv; path?: string; patch: RememberedSettings }): Promise<string[]>
   ```

   `rememberConfig`: `resolveConfig({ name: 'papo', base: BASE, cwd, env, path })` (the same call `loadConfig` makes); for each field with a value (and `model !== ''`): `target = sourceOf(field)`; when the layer that set it is `base` (path `(defaults)`) or absent, `target = userConfigPath(env)`. Group by target; per file: `readFile` (ENOENT -> `{}` and `mkdir -p` its folder), `JSON.parse` (a parse failure throws `ConfigurationError` naming the file), set the fields, `writeFile(JSON.stringify(json, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : ''))`.

3. `chat.ts`: `modelRef()` becomes `if (config.model !== undefined) return config.model;` then the listed lookup cached in `listedModel` (rename of `defaultModel`); `settingsOf` reads `own?.model ?? config.model ?? listedModel ?? ''`.

4. `commands.ts`: `Papo.remember = (patch) => rememberConfig({ cwd: workspace, ...(path ? { path } : {}), patch }).then((files) => { Object.assign(config, patch without '' model); return files; })`; the mutation is the point (both backends hold the same `config`), said in a comment. `rememberedOf(patch: Partial<Settings>): RememberedSettings` picks the three fields (one helper in `commands.ts`, exported for the screen). `say` calls it when `input.session` is undefined and the patch is non-empty; `session.set` always when non-empty; the output line gains `remembered in <file>` per file.

5. `screen/app.tsx` `controller.configure`: after the store/kv update, `const files = await papo.remember(rememberedOf(patch))` in its own try; failure -> `report(error)`.

6. Tests. `config` tests: a patch on a temp home with no file creates `~/.config/papo/config.json` (via `XDG_CONFIG_HOME`) with `model`; a user file with 4-space indentation keeps it and its other fields; a project `.papo.json` that sets `model` receives the model while `permissions` (unset anywhere) goes to the user file; `--config` path as source; `model: ''` writes nothing; a malformed file throws `ConfigurationError`. `commands.test.ts`: `session set -m fake/other` then a fresh `openPapo` (same globals) starts a new session on `fake/other`; `say -m` on a new session likewise. `screen.test.ts`: the model chip writes the file (the test's `home`/`XDG_CONFIG_HOME` pointed at a temp folder).

## Validation

- `pnpm --filter @cofold/papo typecheck`; `pnpm vitest run --project @cofold/papo`; `pnpm check`.
- By hand: two providers in `config.json`, pick `local_provider/<m>` on the chip, quit, start `papo`: the chip shows it.

## Resume

- Step 1 built 2026-09-16 (the fix for `model "" must be written <provider>/<model>` on the first message of a new conversation); papo 117 tests green.
- Steps 2-6 built 2026-09-16.
  `types/config.ts`: `RememberedSettings`.
  `config.ts`: `userConfigPath`, `indentOf`, `rememberConfig` (the base layer is told apart by `layers[].kind`, not by its `(defaults)` path text; an empty patch returns `[]` before the layers are resolved); exported from `index.ts` with the type.
  `chat.ts`: `modelRef()` returns `config.model` first, the cache is `listedModel`; `settingsOf` reads `own?.model ?? config.model ?? listedModel ?? ''`.
  `commands.ts`: `Papo.remember`, `rememberedOf(patch)`, and `rememberInto({ config, cwd, env?, path? })`, the factory `openPapo` calls (the plan had the closure inline in `openPapo`; the factory is what lets a test build a `Papo` over a temp home without copying the `config` mutation).
  `say` remembers when `input.session` is undefined, after the turn has settled (not before `wait`, so a file that cannot be written never leaves a turn running unwatched); `session set` remembers after `configure`; both print `remembered in <file>` per file and add `remembered: string[]` to the JSON output when a file was written.
  `screen/app.tsx` `controller.configure`: `papo.remember(rememberedOf(patch))` in its own `try` after the store/kv write; a failure is `report`ed.
  `claude/chat.ts`: `configured` became a function so `defaults()` reads `config.model` each time; the plan said the Claude backend already read `config`, which held for `permissions` and `reasoning` only.
  `README.md`: the Settings section says what is written where; the layout lists `rememberConfig`.
- Tests: `config.test.ts` "rememberConfig" (7 cases: user path, indentation, fresh user file with `mkdir`, 4-space file kept, project file for `model` and user file for `permissions` in one call, `--config` file, `''` and `{}` write nothing, malformed file refused and left as it was); `commands.test.ts` "remembers -m on a new session and session set..." (three fresh programs over one store and one temp `XDG_CONFIG_HOME`; `-m` on an existing session is not remembered); `screen.test.ts` "remembers a chip's pick..." (the permissions chip, since the model picker was being rewritten concurrently under task 02 and both chips reach `controller.configure`; escape, `n` shows the remembered mode).
  The three test helpers that build a `Papo` by hand (`shell()` in `commands.test.ts`, `screen()` in `screen.test.ts`, the claude `open`) got `remember: async () => []` so no test writes the machine's own file.
- Evidence: `pnpm --filter @cofold/papo typecheck` clean; `pnpm vitest run --project @cofold/papo` 129 tests green; `pnpm check` 67 files, 773 tests green (2026-09-16).
- Not done by hand: the two-provider pick, quit, restart check in Validation.
