---
title: CLI-06.2 - The conversation heads with the session's identity, settings, place and usage
status: accepted
date: 2026-09-18
refs:
  - code://packages/papo/src/screen/chat.tsx - the head
  - code://textui/packages/chat/src/sessionhead.tsx - `ChatSessionHead`
---

## Context

papo's transcript had no header once a conversation existed; the user asked for the session's id and other information about the session at the top.
`@textui/chat`'s `ChatSessionHead` shows title and status, harness and model, settings rows, workspace, started/updated and the id, and takes more rows.
The fork was which groups of rows papo shows.

## Decision

All four: identity (title, status, session id, started/updated), settings (model, permissions, thinking, auto-compact), place (workspace and home), usage (turns and tokens).
The head scrolls with the transcript, as the component is designed.

Source: user (2026-09-18), asked "The session header: which rows should ChatSessionHead show in papo?" (multi-select over the four groups): all four chosen.

## Options

Fewer rows were offered as the other answers; none was left out.
