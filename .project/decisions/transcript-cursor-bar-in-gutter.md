---
title: CLI-05.3 - The transcript marks the block under the cursor with an accent bar in a gutter every block has; tool and thought rows keep their background too
status: accepted
date: 2026-09-16
refs:
  - code://textui/packages/chat/src/bubble.tsx#L23-L28 - `Gutter`: a one-cell column filled with the theme's left border rule in `borderSubtle`
  - code://textui/packages/chat/src/transcript.tsx#L91-L175 - `ChatBlockView`: `said`, `header`, `prose`, `reasoning`, `notice`, `failure`, `tool`, `queued`; only `reasoning` and `tool` read `active`
  - code://textui/packages/chat/src/toolcall.tsx#L70 - the tool row's `bg: 'selected'` when active; no gutter
  - code://textui/packages/chat/src/bubble.tsx#L48-L62 - `ChatBubble.active` exists and paints the same background; the transcript never passes it
---

## Context

Arrow up and down move a cursor through the transcript's blocks, but only a tool row or a thought shows where it is (a blue background); a paragraph of prose, a user's message or a turn header shows nothing.
The person asked for a mark that works on every block and shows the line position while moving.

## Decision

Every block has a one-cell gutter at its left edge: prose, thoughts and the user's messages keep the rule they draw today; tool rows, notices, failures and queued rows gain the column, blank when the cursor is elsewhere.
A block whose first row already carries a glyph in that column has that glyph as its gutter cell: the turn header's bullet and the user line's chevron stay in column 0, and no second gutter is added before them.
The block under the cursor draws a heavy bar (the theme's `bold` border's left rule, `┃`) in the `accent` colour down the whole height of the block, in that gutter; on the header's and the user line's first row the bar replaces the bullet or the chevron while the block is active, so the layout does not shift.
Tool rows and thoughts keep their `bg: 'selected'` when active as well; nothing else gains a background.
On that background the row's text takes `fg: 'inverted'` (the theme's own rule for `selected`: "carries `inverted` text"), so the name, the summary and the thought's words stay readable; the status glyph keeps its tone.

Source: user, 2026-09-16, asked "How should the transcript show which block the cursor (arrow up/down) is on?": "Accent bar in the gutter, and keep the background on tool/thought rows"; then "blue bg, but change color also? of the selected? so blue bg does not affect much".
Source: user, 2026-09-16, on the linked build: "the model start is 2 char of[f]" (the header had moved to column 2).

## Consequences

Tool rows move two cells to the right, in line with the text of the prose; headers and the user's lines stay in column 0; the cursor is visible on a wrapped paragraph on every one of its lines.
The bar survives a terminal without colour (it is a different glyph), which a background does not.

## Options

The bar alone, with the background removed from tool and thought rows, gave one signal for every block; the user kept the background.
Recolouring each block's own glyph (chevron, bullet, status glyph) needed no column but marked only the first line of a paragraph.
