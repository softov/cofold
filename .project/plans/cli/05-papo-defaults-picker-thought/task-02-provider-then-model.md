---
title: The model chip asks the provider first, then that provider's models
status: done
depends: []
layer: papo screen
refs:
  - code://textui/packages/core/src/types/command.ts#L37-L60 - `ArgSpec.choices`: gains the collected arguments
  - code://textui/packages/widgets/src/overlay/command-palette.ts#L236-L300 - `drillInto(command, arg, collected)`: the one place `choices` is called; `answer` already passes `collected` on
  - code://textui/packages/widgets/src/overlay/command-palette.ts#L526-L548 - `argumentOf(command, collected)`: an argument with a `default` and no `choices` is not asked
  - code://packages/papo/src/screen/app.tsx#L363-L377 - `compose.model` today
  - code://packages/papo/src/screen/chat.tsx#L40-L48 - the chip's label `settings.model || 'first listed model'`
  - code://packages/papo/src/types/chat.ts - `ModelRow { provider, ref, ... }`
  - code://packages/papo/src/config.ts#L170-L175 - `splitModel(ref)` for the current provider
---

## Objective

With more than one provider configured, the model chip asks which provider, then lists that provider's models only; with one, it lists the models at once ([CLI-05.2](../../../decisions/picker-choices-see-earlier-answers.md)).

## Files

- `UPDATE: textui/packages/core/src/types/command.ts:44` - `choices?: ArgChoices | ((collected: Readonly<Record<string, unknown>>) => Promise<ArgChoices> | ArgChoices)`.
- `UPDATE: textui/packages/widgets/src/overlay/command-palette.ts:242` - `arg.choices(collected)`.
- `UPDATE: textui/packages/widgets/src/overlay/command-palette.test.ts` (or the existing palette test file) - a two-argument command whose second list depends on the first answer.
- `UPDATE: textui docs` where `ArgSpec.choices` is documented (`rg "choices" docs packages/core/README.md`).
- `UPDATE: packages/papo/src/screen/app.tsx:363-377` - `compose.model` with `provider` and `model` arguments.
- `UPDATE: packages/papo/src/screen/screen.test.ts` - the two-step pick with two providers; the one-step pick with one.
- `UPDATE: packages/papo/README.md` - one line on the chip.

## Steps

1. textui: the type and the call as in Files; a `choices` function that takes no parameter is unchanged TypeScript-wise (a zero-parameter function is assignable). Rebuild textui (`pnpm build` in `F:/github/textui`), run its `pnpm typecheck` and `pnpm test`, and its `check:exports` / `docs:check` if they cover the type.

2. papo `compose.model`:

   ```ts
   {
     id: 'compose.model', title: 'Model', category: 'Compose', slots: ['palette'],
     args: [
       {
         name: 'provider', type: 'string' as const, required: true, description: 'Which provider',
         get default(): string | undefined { const model = settings()?.model; return model ? splitModel(model).provider : papo.config.providers[0]?.id; },
         // Asked only when there is a choice to make: with one provider the default stands and the palette skips it (argumentOf).
         ...(papo.config.providers.length > 1 ? { choices: () => papo.config.providers.map((provider) => ({ value: provider.id, label: provider.id, description: provider.baseUrl })) } : {}),
       },
       {
         name: 'model', type: 'string' as const, required: true, description: 'Which model answers',
         get default(): string | undefined { const model = settings()?.model; return model ? splitModel(model).modelId : undefined; },
         descriptions: 'below' as const,
         choices: (collected) => (app.store.get<ModelRow[]>(MODELS) ?? []).filter((row) => row.provider === collected['provider']).map((row) => ({ value: row.id, label: row.id, description: ... as today })),
       },
     ],
     run: (args) => { void controller.configure({ model: `${String(args['provider'])}/${String(args['model'])}` }); },
   }
   ```

   The `models` list is still loaded once in the background (`MODELS`); a provider that could not be reached shows an empty list and the status row already says why.

3. Tests as in Files; `chat.tsx` needs no change (`argumentOf(command)` finds the first askable argument).

## Validation

- textui: `pnpm build && pnpm typecheck && pnpm test` green.
- facio: `pnpm --filter @doopx/papo typecheck`; `pnpm vitest run --project @doopx/papo`; `pnpm check`.
- By hand: two providers -> the chip asks the provider, then the models; one provider -> the models at once.

## Resume

Done 2026-09-16.
textui: `ArgSpec.choices` resolvers take `collected: Readonly<Record<string, unknown>>` (`packages/core/src/types/command.ts`); `drillInto` passes it (`packages/widgets/src/overlay/command-palette.ts`); `docs/platform/commands.md` documents the dependent list; two palette cases in `packages/testing/test/overlays.test.ts` ("hands a resolver the answers given so far", "counts a default that stood as an answer the next resolver can see").
papo: `compose.model` in `screen/app.tsx` has `provider` then `model`; the `run` joins them; `README.md` says the chip asks the provider first; `screen.test.ts` covers one provider (models at once) and two (provider, then that provider's models only).
Evidence: textui `pnpm build`, `typecheck`, `test` (every suite), `lint` (0 errors), `docs:check` (0 errors), `check:exports` (0 problems); papo screen tests 13 green.

Deviations, with the code that forced them:
- The palette's `collected` did not carry a skipped argument's default: `argumentOf` skips `provider` when its default stands, but `execute` fills defaults only at the end, so the `model` resolver saw `collected = {}` and listed nothing with one provider (the dump showed "Nothing to choose").
  Fixed in textui, not papo: `drillInto` hands the resolver `answeredBefore(command, arg, collected)`, the defaults of the arguments declared before this one under the answers given; `finish`/`execute` are unchanged.
- The providers offered are the ones the listed models name (`MODELS` rows' `provider`, each once), not `papo.config.providers`: the claude backend lists `claude/<model>` with no configured provider, and the plan's code would have asked the person to type a provider there (or, with an unrelated provider configured, filtered to an empty list).
  `choices` on `provider` is a getter (`undefined` until two providers are listed), cast `as ArgSpec` because `exactOptionalPropertyTypes` refuses a getter typed `| undefined`; every reader treats an absent `choices` and an `undefined` one the same (`argumentOf`, `drillInto`).
- A zero-argument *declaration* still typechecks; a zero-argument *call* of a resolver does not: `packages/textide/test/panels.test.ts:139` called `choices()` and now passes `{}`.

Finding, not changed: with `openAt` (the chip's picker) `escape` closes the palette on the second question too (`if (pending && !openAt) back()`); backing to the provider question is arguably better, but the plan does not settle it.
