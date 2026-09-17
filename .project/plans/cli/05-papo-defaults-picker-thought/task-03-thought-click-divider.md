---
title: A thought opens and closes on a mouse click and ends with a divider when open
status: done
depends: []
layer: papo screen
refs:
  - code://textui/packages/chat/src/bubble.tsx#L142-L190 - `ReasoningBlock`: the summary row has no `onClick`; nothing closes the block visually when open
  - code://textui/packages/chat/src/toolcall.tsx#L70-L85 - `ToolCallRow`: `onClick: onToggle` on the header row, `style={{ hover: { bg: 'hover' } }}`, the pattern
  - code://textui/packages/chat/src/transcript.tsx#L126-L138 - the transcript passes `expanded` and `active` to `ReasoningBlock`, not `onToggle`
  - code://textui/packages/widgets/src - `Divider` (exported; papo imports it from `@textui/widgets` in `screen/chat.tsx`)
---

## Objective

A thought toggles on a mouse click like a tool row does, and an open thought ends with a divider (user, 2026-09-16: "the session thinking cannot be expanded with mouse click"; "a line separation at end when expanded").

## Files

- `UPDATE: textui/packages/chat/src/bubble.tsx:142-190` - `ReasoningBlockProps.onToggle?(): void`; `onClick` and the hover on the summary row; a `Divider` after the text when expanded.
- `UPDATE: textui/packages/chat/src/transcript.tsx:126-138` - pass `onToggle`.
- `UPDATE: textui/packages/chat/src/*.test.ts*` - the block's click toggles; the divider is drawn when expanded and not when collapsed (use the existing transcript or bubble tests as the pattern).
- `UPDATE: textui docs/components` where `ReasoningBlock` props are listed (`pnpm docs:props` regenerates; `docs:check` says).

## Steps

1. `ReasoningBlock`: `const { content, expanded, streaming, summary, markdown, onToggle, ...rest } = props;`; the summary `Row` gains `{...(onToggle ? { onClick: onToggle } : {})}` and `style={{ hover: { bg: 'hover' } }}` (the tool row's comment applies: the row is the thing that opens).
   When `expanded`, after the text `Row`: `<Divider />` (the widgets' one; if it needs a width, `flex={1}` inside a `Row` with the same one-cell lead as the text so it lines up under it).
2. `transcript.tsx`: `<ReasoningBlock ... onToggle={onToggle} />`.
3. Tests and docs as in Files. Rebuild textui; papo needs no source change, only the rebuilt link (`pnpm --filter @facio/papo build` then its tests).

## Validation

- textui: `pnpm build && pnpm typecheck && pnpm test`; `pnpm docs:check` if it covers the props.
- facio: `pnpm vitest run --project @facio/papo` (screen tests) green.
- By hand: in `papo`, click a "thought, N words" row: it opens; click again: it closes; open, a rule under the text.

## Resume

Done 2026-09-16.
`ReasoningBlock` (`textui/packages/chat/src/bubble.tsx`) takes `onToggle?(): void`; its summary row has `onClick` and the tool row's `hover: { bg: 'hover' }`; open, a `Divider flex={1}` follows the text under the same one-cell lead.
`transcript.tsx` passes `onToggle`.
Tests: `bubble.test.tsx` "toggles when its row is clicked, like a tool row", "ends with a rule when open, and draws none when folded" (the rule is matched against `theme.dividerChars().horizontal`, since the built-in themes draw `┈`, not `─`); `transcript.test.tsx` "opens a thought on a click, the way it opens a tool row".
Docs: the chat package's props are not in the generated `docs/components` (extract-props reads widgets, core and documents only), so nothing to regenerate; `docs:check` green.
papo needed no source change; rebuilt from the link.
No deviations.
