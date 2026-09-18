---
title: The conversation heads with what the session is
status: done
depends: [01]
layer: papo
refs:
  - code://textui/packages/chat/src/sessionhead.tsx - `ChatSessionHead`
  - code://packages/papo/src/screen/chat.tsx#L82-L88 - the head today
  - code://packages/papo/src/screen/sessions.tsx#L13 - `sessionView`
  - code://packages/papo/src/screen/app.tsx#L32-L38 - `PERMISSION_LABELS`, `REASONING_LABELS`
---

## Objective

The transcript opens with the session's identity, settings, place and usage (user, 2026-09-18: "in papo we are missing session header info, with id and other information about the session"; the rows chosen in CLI-06.2).

## Files

- `UPDATE: packages/papo/src/screen/state.ts` - `PLACE` (`{ workspace, home }`), set once at boot.
- `UPDATE: packages/papo/src/screen/chat.tsx` - the head: `ChatSessionHead` over `sessionView(snapshot.session)` with `model` and the settings rows (Permissions, Thinking, Auto-compact, Home, Turns, Tokens), memoised on a signature; the "new conversation" line stays before the first message.
- `UPDATE: packages/papo/src/screen/screen.test.ts`.

## Steps

1. `sessionView` gains `workingDirectories` from `row.workspace` (it already does when set).
2. The head, as ahpc mounts it, with a `Divider` under it.

## Validation

`pnpm vitest run --project @facio/papo`; by hand, the head after the first message.

## Resume

Done 2026-09-18; see implemented.md.
