---
title: CLI-05 - papo remembers what a person chooses, asks the provider before the model, and opens a thought on click
domain: cli
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/cli/01-papo/plan.md
  - plans/cli/04-papo-harness-adoption/plan.md
decisions:
  - decisions/papo-remembers-picks-in-config.md
  - decisions/picker-choices-see-earlier-answers.md
  - decisions/transcript-cursor-bar-in-gutter.md
refs:
  - code://packages/papo/src/chat.ts#L51,L74-L86,L113-L122 - `defaultModel`, `modelRef()` (first listed, asked once), `settingsOf` (session over `config.*`)
  - code://packages/papo/src/chat.ts#L96-L107 - `checkSettings`: rejected `model: ''`, the word `settingsOf` itself uses for "unset" (the bug of this day, fixed in task 01)
  - code://packages/papo/src/config.ts#L126-L158 - `loadConfig`: `resolveConfig({ name: 'papo', base, cwd, env, path })`, then `PAPO_*` over the files
  - code://packages/config/src/index.ts#L75-L137 - `resolveConfig` returns `layers` and `sourceOf(path)`; the pattern for finding which file to write
  - code://packages/papo/src/commands.ts#L84-L115 - `Papo { chat, config, workspace, home }` and `openPapo`: where the configuration is loaded once per program
  - code://packages/papo/src/commands.ts#L24-L38,L367-L389 - `SETTING_FIELDS`, `settingsPatch`, `session.set`: the shell's way to choose
  - code://packages/papo/src/screen/app.tsx#L110-L125,L189-L202 - `controller.send` (a new conversation sends the draft settings) and `controller.configure` (the chips)
  - code://packages/papo/src/screen/app.tsx#L363-L377 - `compose.model`, one argument over `MODELS`
  - code://packages/papo/src/screen/chat.tsx#L40-L48,L127-L135 - the chips and `openPicker` on the one argument
  - code://textui/packages/core/src/types/command.ts#L37-L60 - `ArgSpec`; `choices` gains the collected arguments
  - code://textui/packages/widgets/src/overlay/command-palette.ts#L236-L300,L526-L548 - `drillInto`, `answer`, `argumentOf`: the palette walks the arguments already
  - code://textui/packages/chat/src/bubble.tsx#L142-L190 - `ReasoningBlock`: chevron and summary row, no `onClick`, no divider
  - code://textui/packages/chat/src/toolcall.tsx#L55-L85 - `ToolCallRow`: `onClick: onToggle` on the header row with `hover: { bg: 'hover' }`, the pattern the thought copies
  - code://textui/packages/chat/src/transcript.tsx#L126-L138 - the transcript renders `ReasoningBlock` with `expanded` and `active` and passes no `onToggle`
---

## Goal

A person with several providers picks one and then a model, once; the next conversation starts from that pick, and so from the permission mode and thinking level last chosen.
A thought in the transcript opens and closes on a mouse click like a tool row does, and ends with a divider when open.
The block the cursor is on is marked on every block kind, and a selected tool row or thought stays readable on its background.
The first message of a new conversation no longer fails with `model "" must be written <provider>/<model>`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "splitModel|providerFor" packages/papo/src` - `checkSettings` and `agentFor` are the callers; `''` reached `splitModel` through `checkSettings` from the screen's `send`.
- `rg "loadConfig" packages/papo/src` - one runtime call, in `openPapo`; nothing writes a configuration file.
- `rg "onClick|onToggle" textui/packages/chat/src` - the tool row and the controls take clicks; the reasoning block does not.
- `rg "choices\(\)" textui/packages` - one call, `drillInto`; nothing else resolves an argument's choices.

### Runtime path

```
chip / session set / say -m  -> patch                -> chat.configure | say({ settings })   (session kv, as today)
                             -> papo.remember(patch)  -> rememberConfig(): resolveConfig().sourceOf(field) ?? user file -> JSON written, indentation kept
                                                      -> config.model / permissions / reasoning updated in force -> settingsOf(new session) starts from them
chip "model" -> openPicker(compose.model) -> provider (skipped with one) -> models of that provider (choices(collected)) -> configure({ model: 'provider/model' })
transcript reasoning row -> onClick -> onToggle(block.id) -> expanded -> content, then a Divider
Feed cursor -> BlockView active -> Gutter active (heavy bar, accent) on every kind; tool/thought also bg selected + inverted text
```

### Gaps

- `Not found: any write of the configuration - searched writeFile, config.json in packages/papo/src` (only transcript exports write files).
- `Not found: a picker argument whose choices depend on another - searched collected, choices( in textui/packages`.
- `Not found: onClick on ReasoningBlock`.
- `checkSettings` rejected `model: ''`, so a new conversation from the screen (which sends its draft settings whole) failed before the first turn; the same `''` was then written to the session's settings by `say`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| [CLI-05.1](../../../decisions/papo-remembers-picks-in-config.md) | The model, permission mode and thinking level a person chooses are written back into the configuration file that sets them (else the user file), every time; the in-force config follows | User (2026-09-16), four answers quoted in the file |
| [CLI-05.2](../../../decisions/picker-choices-see-earlier-answers.md) | textui's `choices` function receives the collected arguments; the model chip asks the provider, then that provider's models | User (2026-09-16) |
| [CLI-05.3](../../../decisions/transcript-cursor-bar-in-gutter.md) | An accent bar in a gutter every block has marks the cursor; tool rows and thoughts keep `bg: selected` and take `inverted` text on it | User (2026-09-16), two answers quoted in the file |

Settled without a decision (a defect, or the user's ask with one workable shape):

| What | Source | Task |
| --- | --- | --- |
| `model: ''` is "unset": `checkSettings` accepts it and `patchSettings` removes the session's own model instead of storing `''` | defect (user, 2026-09-16: the first message of a new conversation failed) | 01 (built) |
| `models()` skips a provider that cannot be reached (warned once) and `models({ provider })` lists one; `providers()` lists what is configured; the chip asks a provider's models when it is chosen, not every provider at start | defect (user, 2026-09-16: "with the config always choose local ai, that is not running... I cannot make it use openrouter, only removing the other") | 05 |
| A thought opens and closes on click, with the tool row's hover, and ends with a `Divider` when expanded | user, 2026-09-16: "the session thinking cannot be expanded with mouse click"; "a line separation at end when expanded" | 03 |

## Proposed architecture

- **Data flow** - `config.ts` gains `rememberConfig({ cwd, env?, path?, patch })`: resolves the layers again, groups the patch's fields by target file, reads each (or `{}`), sets the fields, writes with the file's indentation, returns the paths written. `Papo` gains `remember(patch): Promise<string[]>` (built in `openPapo`) that calls it and mutates `papo.config` (the object both backends hold). The screen's `controller.configure` and the shell's `session.set` / `say` (new session with `-m/-p/-t`) call `papo.remember` with the model / permissions / reasoning part of the patch.
- **State flow** - the harness backend's `modelRef()` reads `config.model` live (the `listedModel` cache holds only the listed answer); the Claude backend's `defaults()` reads `config.model`, `permissions` and `reasoning` each time it is called (task 01 made the model part live: it was computed once at start).
- **Layer responsibilities** - `@facio/papo` `config.ts`: the write · `commands.ts`: `Papo.remember` · `screen/app.tsx`: the chips call it; `compose.model` with two arguments · textui `@textui/core`, `@textui/widgets`: `choices(collected)` · textui `@textui/chat`: the thought's click and divider.
- **Source-of-truth files** - `code://packages/papo/src/config.ts`, `code://packages/papo/src/commands.ts` (`Papo`), `code://textui/packages/core/src/types/command.ts`, `code://textui/packages/chat/src/bubble.tsx`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `''` is unset; picks are remembered in the configuration](task-01-remember-picks.md) | done | - |
| [02 - The model chip asks the provider first](task-02-provider-then-model.md) | done | - |
| [03 - A thought opens on click and ends with a divider](task-03-thought-click-divider.md) | done | - |
| [04 - The cursor bar in the gutter; inverted text on selected rows](task-04-cursor-bar.md) | done | 03 |
| [05 - A provider that is down does not hide the others; `providers` and `models [provider]` in the shell](task-05-models-per-provider.md) | done | - |
| [05 - A provider that is down does not hide the others; `providers` and `models [provider]` in the shell](task-05-models-per-provider.md) | done | - |
| [05 - A provider that is down does not hide the others; `providers` and `models [provider]` in the shell](task-05-models-per-provider.md) | done | - |

## Risks and tradeoffs

- papo now edits a file the person also edits by hand: only the fields chosen are rewritten and the indentation is kept (JSON has no comments to lose); a write failure is reported on the status row and the pick still applies to the session.
- `bypassPermissions` chosen once is remembered for every next conversation (the user's choice); the permissions chip shows it, and `default` is one pick away.
- textui changes rode on the linked checkout until textui 0.6.1 (2026-09-17); papo now depends on `^0.6.1` from the registry.

## Resume state

- **Done so far:** planned 2026-09-16; task 01 done 2026-09-16 (`rememberConfig` in `config.ts`, `Papo.remember` built by `rememberInto` in `commands.ts`, the chips, `say` and `session set` call it; `modelRef()` and the Claude backend's `defaults()` read `config.model` live; `pnpm check` green, 773 tests).
- **Done so far (cont.):** tasks 02, 03, 04 done 2026-09-16 (textui: `choices(collected)` with the skipped defaults, the thought's click and divider, the cursor bar and the inverted rows; papo: `compose.model` in two questions); task 05 done 2026-09-16 (`models({ provider })` skips a provider that is down when listing all, `providers()`, the shell's `providers` and `models [provider]`, the chip lists a provider's models when it is chosen); the plan is built, see [implemented.md](implemented.md).
- **Next action:** none; the user runs the linked build by hand (two providers on the chip, the bar while arrowing, a thought's click) and publishes textui 0.6.0 so papo's link becomes a dependency.
- **Open questions:** none.
- **Watch out for:** `PAPO_MODEL` / `FACIO_MODEL` in the environment still wins over the file after a pick (applied after the layers); `resolveConfig` needs the same `cwd` / `path` / `env` `openPapo` used, so the target file is the one that was read.

## Final verification checklist

- [x] A new conversation from the screen with no `model` in the configuration sends its first message (`chat.test.ts`).
- [x] Picking a model on the chip writes `model` into the file that set it (or the user file), keeps the file's indentation, and the next new conversation starts from it; the same for permissions and thinking; `session set -m` and `say -m` on a new session do the same (`config.test.ts` "rememberConfig", `commands.test.ts` "remembers -m on a new session...", `screen.test.ts` "remembers a chip's pick...").
- [x] With two providers the chip asks the provider, then lists only that provider's models; with one provider it lists the models at once (`screen.test.ts`, two cases; textui `overlays.test.ts`, two cases).
- [x] A thought opens and closes on a mouse click and shows a divider under its text when open (textui `bubble.test.tsx`, `transcript.test.tsx`).
- [x] The cursor bar follows arrow up/down on prose, user lines, headers, tool rows and thoughts; a selected tool row's text is `inverted` on the blue (textui `transcript.test.tsx` "the cursor"; the arrowing itself by hand, owed).
- [x] With `local_provider` down and `open_router` up, the chip offers both, lists OpenRouter's models, and says why the local one cannot be listed; `papo providers` lists both, `papo models local_provider` fails with the provider's error (`screen.test.ts`, `commands.test.ts`, `chat.test.ts`).
- [x] `pnpm check` green in facio (67 files, 776 tests after task 05); textui's `build`, `typecheck`, `test`, `lint`, `docs:check`, `check:exports` green.
- [x] `plans/index.md` updated.
