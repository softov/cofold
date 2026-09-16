---
title: Context reduction and `/compact`
status: done
depends: [task-05-streaming.md]
layer: agents
---

## Objective

Context reduction and `/compact`.

## Files

- (see the plan)

## Steps

- Built as `run/compact.ts` + `run/context.ts` `contextOf`: the summary is a `Message { role: 'user', source: 'summary', summarizes: string[] }` (a field, not a part; no model id on it, the step record has the reply), appended to the session; a request carries the newest summary first, then every message no summary stands for (an auto-compacted turn's own input stays out of the summary and after it in the request). `compact({ agent, session })` is a run whose input is the ask (`source: 'system'`) and whose one step writes the summary; `context.autoCompactTokens` writes it in passing before the turn's model step. New event `context.compacted { messageId, summarized, estimatedTokens }`. No `context.strategy` option: there is one strategy, the summary floor plus `recent` after it. `resume()` needs nothing: `contextOf` reads the transcript. Tests: `run/compact.test.ts` (5). papo: `/compact`, `/autocompact`, `compact <session>`, `-a on|off`, `config.context { maxTokens, autoCompact }` at 80% of `maxTokens`.

## Validation

- (see the plan)

## Resume

Done (Built 2026-09-16).
