---
title: The screen shows the runtime's list and keeps only client commands
status: todo
depends: [task-05-papo-service.md]
layer: papo screen
refs:
  - "[code://packages/papo/src/screen/app.tsx#L387-L678](../../../../packages/papo/src/screen/app.tsx#L387-L678) - the client commands, `compose.*` at L393-L444"
  - "[code://packages/papo/src/screen/chat.tsx#L18-L27](../../../../packages/papo/src/screen/chat.tsx#L18-L27) - the `/` list"
  - "[code://packages/papo/src/screen/screen.test.ts#L196](../../../../packages/papo/src/screen/screen.test.ts#L196) - the slash menu test; L283 and L377 test the overlays and `/compact`"
---

## Objective

The `/` menu shows the runtime's commands, then the prompt commands, then the client commands the runtime does not list.
The client copies of runtime commands are gone.

## Files

- `UPDATE: packages/papo/src/screen/app.tsx:387-678` - remove `chat.compact`, `chat.autocompact`, `chat.status`, `chat.usage`, `chat.skill` and `app.config`.
- `UPDATE: packages/papo/src/screen/chat.tsx:18-27` - the `/` list from `Chat.commands()` and the client commands.
- `UPDATE: packages/papo/src/screen/screen.test.ts` - the cases under Validation.

## Steps

1. Remove the six client commands, and the code that only they used.
2. Give each client command a short name for the `/` menu, such as `help` for `app.help`.
3. Build the `/` list as decision table row "The `/` menu" says.
4. Hide a `compose.*` entry from the `/` list when the runtime lists the same name; keep its key binding.
5. Send a picked command at once, or make it the draft `/<name> ` when it has an `argumentHint`.
6. Make `/help` list the runtime's commands first, then the client commands.

## Validation

- `screen.test.ts`: `/status` shows a notice in the transcript, not an overlay.
- `screen.test.ts`: the `/` menu shows `model` once.
- `screen.test.ts`: `/help` lists `compact` before `theme`.
- Run papo at two terminal sizes and open the `/` menu.

## Resume
