---
title: 121 - context.compacted says how many tokens the context has after the summary
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/event.ts#L31-L32 - `context.compacted { messageId, summarized, estimatedTokens }`
  - code://packages/agents/src/run/compact.ts#L88 - the emit
  - code://ahpd/packages/agent-claude/src/session.ts#L1735-L1750 - Claude's `compact_boundary` with `pre_tokens` and `post_tokens`, shown as "Context compacted: N tokens to M"
---

## Context

Claude's compaction notice reports before and after; ours reported before only, so a host could not say what the compaction achieved.

## Decision

`context.compacted { messageId, summarized, kept, estimatedTokens, afterTokens }`: `kept` is the number of messages retained verbatim ([compaction-keeps-tail](compaction-keeps-tail.md)), `afterTokens` the estimate of `contextOf` once the summary is in place.

Source: user, 2026-09-16, asked "Add afterTokens (Claude) / Leave as is".

## Consequences

One more estimate per compaction; papo's notice prints "N tokens to M".
