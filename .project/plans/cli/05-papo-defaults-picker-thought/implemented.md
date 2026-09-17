---
title: CLI-05 - papo remembers what a person chooses, asks the provider before the model, and opens a thought on click - implemented
date: 2026-09-16
refs:
  - git://1705e4ff6d3f2bd0bdf9ffa886560537d1d637d8 - the last commit before this plan's work; everything below is uncommitted on top of it
  - code://packages/papo/src/config.ts - `rememberConfig`, `userConfigPath`, `indentOf`
  - code://packages/papo/src/commands.ts - `Papo.remember`, `rememberedOf`, `rememberInto`
  - code://packages/papo/src/chat.ts - `checkSettings` accepts `''`; `modelRef()` reads `config.model` live
  - code://packages/papo/src/screen/app.tsx - `compose.model` with `provider` then `model`; `controller.configure` remembers
  - code://textui/packages/core/src/types/command.ts - `ArgSpec.choices` resolvers take `collected`
  - code://textui/packages/widgets/src/overlay/command-palette.ts - `drillInto` hands the resolver `answeredBefore(command, arg, collected)`
  - code://textui/packages/chat/src/bubble.tsx - `cursorBar`, `Gutter { active, blank }`, `ReasoningBlock { onToggle, active }`, the divider
  - code://textui/packages/chat/src/transcript.tsx - every block kind marks the cursor
  - code://textui/packages/chat/src/toolcall.tsx - inverted text on the selected row
  - code://packages/papo/src/chat.ts - `models({ provider? })` skips a provider that is down; `providers()`
  - code://packages/papo/src/commands.ts - the `providers` and `models [provider]` actions
---

A model, permission mode or thinking level chosen on a chip or in the shell is written back into the configuration file that set it, so the next new conversation starts from it; the first message of a new conversation with no configured model no longer fails.
The model chip asks which provider when more than one lists models, then that provider's models only.
A thought in the transcript opens and closes on a mouse click and ends with a rule when open.
Arrow up and down mark the block they are on with a heavy accent bar down its left column on every block kind; a selected tool row or thought keeps its blue background and its words read in inverted text on it.
A provider that cannot be reached no longer hides the others: the chip and `papo models` list what answers, and the one that is down says why when asked about; `papo providers` lists what is configured.

## What was built

- `code://packages/papo/src/chat.ts` - `checkSettings` accepts `model: ''` as "unset" and `patchSettings` removes the session's own model on it; `modelRef()` returns `config.model` first and caches only the listed answer (CLI-05.1; task 01).
- `code://packages/papo/src/types/config.ts`, `config.ts`, `index.ts` - `RememberedSettings`; `rememberConfig({ cwd, env?, path?, patch })` resolves the layers again, groups the fields by the file that sets them (else the user file), writes each with its indentation kept and returns the paths written; `userConfigPath`, `indentOf` (CLI-05.1; task 01).
- `code://packages/papo/src/commands.ts` - `Papo.remember(patch)`, built by `rememberInto({ config, cwd, env?, path? })` in `openPapo`; `rememberedOf(patch)`; `say` on a new session and `session set` call it after the turn or the change and print `remembered in <file>` (task 01).
- `code://packages/papo/src/screen/app.tsx` - `controller.configure` remembers the model, permissions and reasoning part of the patch; `compose.model` asks `provider` (choices: the providers the listed models name, when more than one; the current model's provider as default) then `model` (that provider's rows through `choices(collected)`); the `run` joins them (CLI-05.2; tasks 01, 02).
- `code://packages/papo/src/claude/chat.ts` - `defaults()` reads `config.model` each time (task 01).
- `code://textui/packages/core/src/types/command.ts`, `textui/packages/widgets/src/overlay/command-palette.ts` - `choices?: ArgChoices | ((collected: Readonly<Record<string, unknown>>) => ...)`; `drillInto` hands the resolver the answers so far under the defaults of the arguments declared before it that were not asked (`answeredBefore`); `docs/platform/commands.md` documents the dependent list (CLI-05.2; task 02).
- `code://textui/packages/chat/src/bubble.tsx` - `ReasoningBlock.onToggle` with the tool row's click and hover, a `Divider` under the open text; `cursorBar(theme)` (`borderChars('bold').left`); `Gutter { active, blank }`; `ChatBubble.active` marks the gutter and replaces the speaker's glyph with the bar on the first row instead of painting a background; `ReasoningBlock.active` takes `bg: selected` and `inverted` text (tasks 03, 04).
- `code://textui/packages/chat/src/transcript.tsx` - `said`, `prose`, `reasoning` mark their gutter; the header's bullet becomes the bar when active and stays in column 0; `notice`, `failure`, `tool`, `queued` lead with a blank gutter; `onToggle` reaches the thought (tasks 03, 04).
- `code://textui/packages/chat/src/toolcall.tsx` - when active the name, summary and chevron are `inverted`; the status glyph keeps its tone (CLI-05.3; task 04).
- `code://packages/papo/src/types/chat.ts`, `chat.ts`, `claude/chat.ts` - `Chat.models({ provider? })`: every provider in order, one that throws warned once (`provider "<id>": <message>`) and skipped; named, its error is the answer, an unknown id `invalid_options`; `Chat.providers()` and `ProviderRow { id, baseUrl?, key, default }` (task 05).
- `code://packages/papo/src/commands.ts` - `providers` (table, the key never printed, `first listed` / `default` marked) and `models [provider]` (task 05).
- `code://packages/papo/src/screen/app.tsx`, `screen/state.ts` - `PROVIDERS` read once at start from `chat.providers()`; `MODELS` per provider, filled by `modelsOf(provider)` the first time a provider is chosen on the chip; no start-up listing of every provider; a listing that fails is on the status row (`models: <id>: <message>`) with nothing to choose (task 05).
- `code://packages/papo/src/testing.ts` - `testChat({ providers?, warn? })` (task 05).

## Verified

- `@facio/papo`: 8 test files, 134 tests green (`screen.test.ts` 14: the one- and two-provider picks, the dead provider beside a live one, the remembered chip; `config.test.ts` "rememberConfig" 7 cases; `commands.test.ts` "remembers -m on a new session...", "lists the providers and the models of each..."; `chat.test.ts` "starts from the configured defaults..." with `model: ''`, "lists the providers that answer when another cannot be reached..."); build and typecheck green.
- Full facio `pnpm check` on 2026-09-16 after task 05: see the plan's checklist (67 test files, 776 tests, no type errors).
- textui on 2026-09-16: `pnpm build`, `pnpm typecheck` (every workspace), `pnpm test` (every suite, the playgrounds included), `pnpm lint` (0 errors, 6 pre-existing `no-console` warnings in `examples/`), `pnpm docs:check` (0 errors), `pnpm check:exports` (0 problems). New cases: `packages/testing/test/overlays.test.ts` 2 (the dependent resolver, the default that stood), `packages/chat/test/bubble.test.tsx` 2 (click, divider), `packages/chat/test/transcript.test.tsx` 8 (the click through the transcript, "the cursor" 7).
- Not run: papo in a terminal with two providers (the chip's two questions), arrowing through a transcript to watch the bar, a thought's mouse click; the user saw the linked build once during task 04 and corrected the header's column, which the tests now pin.

## Departures from the plan

- CLI-05.2 - the palette's `collected` did not carry a skipped argument's default (`execute` fills defaults only at the end), so the `model` resolver saw no provider with one provider; `drillInto` now hands the resolver the earlier arguments' defaults (`answeredBefore`), and the type's comment and `docs/platform/commands.md` say so.
- CLI-05.2 - the providers offered come from `chat.providers()` (task 05), neither `config.providers` read in the front (the claude backend lists `claude/<model>` with no configured provider) nor the listed models' `provider` fields (task 02's first shape, void once the listing became per provider on demand); `choices` on `provider` is a getter, cast `as ArgSpec` under `exactOptionalPropertyTypes`.
- CLI-05.3 - `BorderStyle` has no `heavy`; the bar is the theme's `bold` border's left rule (`┃`, `|` in ascii) through `cursorBar(theme)`, not a hardcoded glyph.
- CLI-05.3 (amended 2026-09-16 from the user's run of the linked build) - the header's bullet and the user line's chevron are their block's gutter cell and the bar replaces them while active; no second gutter before them, so headers and user lines stay in column 0. `ChatBubble.active` no longer paints `bg: selected`.
- Task 01 - `rememberInto` is a factory `openPapo` calls rather than a closure inline in `openPapo`; the Claude backend's `configured` became a function, since `defaults()` read `config.model` once.
- textui - `packages/textide/test/panels.test.ts` called a resolver with no argument and now passes `{}`; a zero-parameter declaration is unchanged.

## Left for later

- With `openAt` (the chip's picker) `escape` closes the palette on the second question too (`if (pending && !openAt) back()` in `command-palette.ts`); backing to the provider question may read better. Not settled by the plan; not changed.
- textui 0.6.0 has to be published for papo's `@textui/*` link to become a dependency (CLAUDE.md, "linked from the sibling checkout until 0.6.0").
- The manual runs listed under Verified.
