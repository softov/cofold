---
title: CLI-05.1 - papo writes the model, permission mode and thinking level a person chooses back into the configuration file that sets them
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/chat.ts#L51 - `let defaultModel = config.model`: the configured default, or the first model the first provider lists (cli/01 decision 11)
  - code://packages/papo/src/chat.ts#L113-L122 - `settingsOf`: a session's own settings over `config.permissions` / `config.reasoning`
  - code://packages/papo/src/config.ts#L126-L158 - `loadConfig` over `resolveConfig`: the layers `base < user < project < environment < explicit`, then the `PAPO_*` variables
  - code://packages/config/src/index.ts#L75-L137 - `resolveConfig` returns `layers` and `sourceOf(path)`, the file that last set a field
  - code://packages/papo/src/screen/app.tsx#L189-L202 - `controller.configure`: a chip's choice on a new conversation is held in the screen only
---

## Context

A person with two providers picks `local_provider/<model>` on the model chip; the next new conversation starts from `config.model` or, absent that, the first model the first provider lists.
Nothing remembers the pick; the same holds for the permissions and thinking chips.
Where the remembered choice lives, and which chips are remembered, were forks.

## Decision

Every time a person chooses a model, a permission mode or a thinking level (the composer chips, `papo session set --model/--permissions/--reasoning`, `papo say -m/-p/-t` on a new session), papo writes that value into the configuration: `model`, `permissions`, `reasoning`.
The target is the file that currently sets the field (`resolveConfig().sourceOf(field)`, when it is a file layer); a field no file sets goes to the user file `~/.config/papo/config.json` (`$XDG_CONFIG_HOME` honoured), created if absent.
The file's indentation is kept; other fields are untouched.
The in-force `PapoConfig` is updated in the same act, so a new conversation in the same process starts from it; a `PAPO_MODEL` in the environment still wins while it is set (it is applied after the files, as today).
A session's own settings still win over the configuration; `''` (unset) is never written.

Source: user, 2026-09-16, asked "Where should papo keep the last model you picked, so a NEW conversation starts with it": "Write it into config.json"; asked "Which chips should be remembered for the next new conversation?": "Model, permissions and thinking"; asked "When is the pick remembered?": "Every time a person chooses a model"; asked "Config is layered ... When papo remembers a pick, which file does it write?": "The file that currently sets that field, else the user file".

## Consequences

`config.json` is no longer only hand-written; `papo config` (`app.config`) shows what is in force, which is now also what was last chosen.
A project `.papo.json` that sets `model` is edited when a model is picked inside that project, which is what makes the pick take effect there.

## Options

A kv key in papo's own store (`papo/settings`, next to the per-session settings) kept the configuration hand-written and added a third layer of precedence; rejected by the user.
Always writing the user file was simpler but a pick made under a project file that sets the same field would be shadowed and look ignored.
Remembering the model alone avoided carrying `bypassPermissions` from one session into every next one; the user chose to remember all three.
