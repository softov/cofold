---
title: The screen renders the runtime's list and keeps only the external commands
status: todo
depends: [task-04-service.md]
layer: papo screen
refs:
  - code://packages/papo/src/screen/chat.tsx#L17-L26
  - code://packages/papo/src/screen/chat.tsx#L132-L139
  - code://packages/papo/src/screen/app.tsx#L367-L505
---

## Objective

The `/` menu is `Chat.commands()`, then `Chat.skills()`, then the external commands whose name the runtime does not list; picking an internal command sends it, or drafts `/<name> ` when it takes an argument; the client copies of the internal commands are gone.

## Files

- `UPDATE: packages/papo/src/screen/chat.tsx:17-26` - `useSlashCommands` per decision 12 (an internal command and a skill are kind `session`, an external one `client`).
- `UPDATE: packages/papo/src/screen/chat.tsx:132-139` - an internal command with `argumentHint` becomes the draft; one without is sent through `controller.send('/<name>')`.
- `UPDATE: packages/papo/src/screen/app.tsx` - delete `chat.compact`, `chat.autocompact`, `chat.status`, `chat.cost`, `chat.skill`, `app.config`, `controller.compact`, `statusLines`, `costLines`; the controller loads `COMMANDS` on open and on `subscribe`; `app.help` keeps the overlay and lists `Chat.commands()` first, then the external ones (decisions 10, 16).
- `UPDATE: packages/papo/src/screen/info.tsx` - stays for `/help` alone (decision 16); `showInfo` loses its other callers.
- `UPDATE: packages/papo/src/screen/state.ts` - add `COMMANDS`; `INFO` stays for `/help`.
- `UPDATE: packages/papo/src/screen/screen.test.tsx` - the `/status ... in one overlay` test becomes "`/status` lands as a notice in the transcript"; the `/compact` and `/autocompact` test sends them as text; a new test: the menu lists `compact` once and no client `compact`.

## Steps

1. Load commands beside skills in the controller (`chat.commands()`), stored under `COMMANDS`.
2. The menu per decision 12; the external names are the palette commands' short names: `theme`, `help`, `quit`, `markdown`, `export`, `retry`, `clear`, `memory`.
3. Delete the six client commands; the overlay stays for `/help` (decision 16); `clear` stays external and is hidden when the runtime lists one (decision 17).

## Validation

- `screen.test.tsx` as above; `pnpm check`.
- By hand: `papo`, type `/`, see the runtime list; `/compact` folds; `/status` prints into the transcript.

## Resume

