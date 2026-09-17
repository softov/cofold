---
title: CLI-05.2 - A command argument's choices may depend on the arguments answered before it; the model chip asks the provider, then that provider's models
status: accepted
date: 2026-09-16
refs:
  - code://textui/packages/core/src/types/command.ts#L44 - `ArgSpec.choices?: ArgChoices | (() => Promise<ArgChoices> | ArgChoices)`, a resolver that sees nothing
  - code://textui/packages/widgets/src/overlay/command-palette.ts#L236-L300 - `drillInto` resolves `choices` per argument; `answer` walks to the next argument with `collected`
  - code://packages/papo/src/screen/app.tsx#L363-L377 - `compose.model`: one argument, every model of every provider as `provider/model`
  - code://packages/papo/src/chat.ts#L254-L263 - `models()` lists every provider's catalogue as `ModelRow { provider, ref }`
---

## Context

The model chip lists every model of every configured provider in one flat list; OpenRouter alone is hundreds of rows.
The palette already asks a command's arguments one after another, but a `choices` function cannot see the earlier answer, so "the models of the chosen provider" had no way to be asked.

## Decision

textui's `ArgSpec.choices` function receives the arguments collected so far: `choices?: ArgChoices | ((collected: Readonly<Record<string, unknown>>) => Promise<ArgChoices> | ArgChoices)`; the palette passes `collected` in `drillInto`.
A function that ignores its parameter behaves as before.
papo's `compose.model` becomes one command with two arguments: `provider` (choices: the configured provider ids, with the current model's provider as default) and `model` (choices: `models()` rows of `collected.provider`); with one provider configured the `provider` argument is not asked (it carries a `default` and no `choices`, so `argumentOf` skips it).
The chip keeps showing `provider/model`.

Source: user, 2026-09-16, asked "The model picker lists every model of every provider in one flat list ... How should providers be chosen there?": "Two steps: provider, then its models"; asked "The two-step picker ... needs the second list to depend on the first answer. Where does that go?": "textui: `choices(collected)`".

## Consequences

A textui change (core type and the palette), rebuilt from the linked checkout; published with textui 0.6.0.
Any other dependent argument (a branch of a chosen repository, a session of a chosen workspace) is written the same way.

## Options

Two chained papo commands (`compose.provider` storing its answer in the screen store and opening the `compose.model` picker) needed no textui change but glued two pickers through the store and the chip's anchor id; rejected by the user.
One flat list filtered by typing was the status quo.
