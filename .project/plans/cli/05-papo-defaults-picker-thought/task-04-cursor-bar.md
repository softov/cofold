---
title: The block under the cursor shows an accent bar in a gutter every block has; selected rows read in inverted text
status: done
depends: [task-03-thought-click-divider.md]
layer: papo screen
refs:
  - code://textui/packages/chat/src/bubble.tsx#L23-L28 - `Gutter`: one cell, `fill={theme.borderChars().left}`, `fg="borderSubtle"`
  - code://textui/packages/chat/src/bubble.tsx#L48-L75 - `ChatBubble`: `active` paints `bg: 'selected'`; its own gutter row (glyph and rule)
  - code://textui/packages/chat/src/transcript.tsx#L91-L175 - `ChatBlockView`: every block kind; `active` is read by `reasoning` and `tool` only
  - code://textui/packages/chat/src/toolcall.tsx#L55-L85 - `ToolCallRow`: `bg: 'selected'` on the column, `fg` `muted` / `subtle` on the summary and chevron
  - code://textui/packages/core/src/themes/builtin.ts#L126-L136 - "`selected` carries `inverted` text so it has to be light"
  - code://textui/packages/core/src/types/theme.ts#L136 - `borderChars(style?: BorderStyle)`; `heavy` if the union has it
---

## Objective

Arrow up and down show which block they are on, on every block kind: an accent bar down the block's gutter; tool rows and thoughts keep their background and their text turns `inverted` on it ([CLI-05.3](../../../decisions/transcript-cursor-bar-in-gutter.md)).

## Files

- `UPDATE: textui/packages/chat/src/bubble.tsx:23-28` - `Gutter` gains `active?: boolean` (and `blank?: boolean` for the kinds that draw no rule): active -> `fill={theme.borderChars('heavy').left}` (or `'┃'` when the theme has no `heavy` style) and `fg="accent"`; blank and not active -> `fill=" "`.
- `UPDATE: textui/packages/chat/src/bubble.tsx:48-75` - `ChatBubble` passes `active` to its `Gutter`.
- `UPDATE: textui/packages/chat/src/transcript.tsx:91-175` - every case: `said` passes `active` to `ChatBubble`; `header`, `notice`, `failure`, `tool`, `queued` gain a leading `<Gutter blank active={active} />` in a `Row gap={1}` (the tool case wraps `ToolCallRow` in that row with `flex={1}`); `prose` and `reasoning` pass `active` to their `Gutter`.
- `UPDATE: textui/packages/chat/src/toolcall.tsx:70-85` - when `active`: the name, summary and chevron take `fg="inverted"`; the status glyph keeps `look.tone`.
- `UPDATE: textui/packages/chat/src/bubble.tsx` `ReasoningBlock` - gains `active?: boolean` (the transcript already sets `bg` through `rest`; the prop now also turns the chevron, summary and, when open, the text `inverted`; `StreamingText` may need an `fg` pass-through, check `bubble.tsx:120-140`).
- `UPDATE: textui/packages/chat/src/*.test.ts*` - the active block's gutter cell is the heavy bar in accent; an inactive tool row's gutter is blank; the active tool row's name is `inverted`.
- `UPDATE: textui docs/components` for the changed props.

## Steps

1. `Gutter` as in Files; the `borderChars` fallback is checked against `BorderStyle` in `types/theme.ts` (add nothing to the theme; use `'┃'` when `heavy` is not a style).
2. The transcript as in Files: one `Row gap={1}` per block with the gutter first, so every block's text starts at the same column.
3. Inverted text on the selected tool row and thought as in Files.
4. Tests and docs; rebuild textui; `pnpm --filter @facio/papo build` and the screen tests (snapshots of the transcript will shift by two cells for tool rows and headers: update them and say so in the Resume).

## Validation

- textui: `pnpm build && pnpm typecheck && pnpm test`; `pnpm docs:check`.
- facio: `pnpm vitest run --project @facio/papo`; `pnpm check`.
- By hand: arrow through a transcript in `papo`: the bar follows on prose, on the user's lines, on tool rows and thoughts; the selected tool row's text is readable on the blue.

## Resume

Done 2026-09-16.
`Gutter` (`textui/packages/chat/src/bubble.tsx`) takes `active` and `blank`; `cursorBar(theme)` is the one place the bar glyph comes from: `theme.borderChars('bold').left`.
`ChatBubble` no longer paints `bg: selected` when active: the bar runs down its gutter, and on the first row it replaces the speaker's glyph.
`transcript.tsx`: `said` passes `active`; the header's bullet becomes the bar when active and stays in column 0; `prose` and `reasoning` pass `active` to their `Gutter`; `notice`, `failure`, `tool`, `queued` lead with `<Gutter blank>` in a `Row gap={1}` (`ToolCallRow` with `flex={1}`).
`ToolCallRow`: when active the name, summary and chevron take `fg: inverted`; the status glyph keeps its tone.
`ReasoningBlock` takes `active`: `bg: selected`, chevron and summary `inverted`, and the open text `fg: inverted` instead of `quiet` (MarkdownView's `quiet` sets every run to `muted` itself, so a box-level `fg` could not reach it).
Tests: `transcript.test.tsx` "the cursor" (7 cases: the bar on every kind, every line of a block, the glyph stand-in on header and user line, blank gutters, columns, inverted tool row and thought, no background on prose or said).
Evidence: textui `pnpm build`, `typecheck`, `test`, `lint`, `docs:check`, `check:exports` green; papo screen tests green (no snapshot files exist in papo's tests, so nothing shifted there; the transcript tests in textui that pinned columns were rewritten).

Deviations, with the code that forced them:
- `BorderStyle` has no `heavy`; its heavy rule is `bold` (`┃`, `|` in ascii). The bar is `theme.borderChars('bold').left` rather than a hardcoded `┃`, textui's rule being that glyphs come from the theme so an ascii terminal draws what it can.
- The user, on the linked build ("the model start is 2 char of[f]"): the header's bullet and the user line's chevron are their block's gutter cell; the bar replaces them while active and no second gutter is added. Decision CLI-05.3 amended (Decision, Consequences, second Source line).
- `ChatBubble.active` used to paint `bg: selected`; CLI-05.3 says nothing but tool rows and thoughts gains a background, so it now marks the gutter only (the bubble playground shows the bar instead of the blue).
- `StreamingText` needed no `fg` pass-through: `fg` is a `BoxProps` field it already spreads.
