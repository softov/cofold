---
title: A cut turn says why it was cut
domain: agent
status: draft
priority: high
created: 2026-10-14
revalidated: 2026-10-14
decisions: []
refs:
  - "[code://packages/agents/src/run/turn.ts#L138-L149](../../../../packages/agents/src/run/turn.ts#L138-L149) - `interrupt` writes `INTERRUPTED` and `INTERRUPTED_TOOL` for every abort, a timeout too"
  - "[code://packages/agents/src/message/markers.ts#L1-L6](../../../../packages/agents/src/message/markers.ts#L1-L6) - the two texts, which stay as the defaults"
  - "[code://packages/agents/src/types/abort.ts#L1](../../../../packages/agents/src/types/abort.ts#L1) - `AbortReason` already carries `kind` and the optional `reason`"
  - "[code://packages/agents/src/run/abort.ts#L11](../../../../packages/agents/src/run/abort.ts#L11) - an external `AbortSignal` cancels with `reason: 'signal'`"
  - "[code://packages/agents/src/run/handle.ts#L56-L59](../../../../packages/agents/src/run/handle.ts#L56-L59) - `cancel({ reason })` and `submit({ type: 'cancel' })` pass the caller's reason on"
  - "[code://packages/agents/src/types/run.ts#L7-L36](../../../../packages/agents/src/types/run.ts#L7-L36) - `RunArgs`, `CompactArgs` and `ResumeArgs`, where the option goes beside `signal`"
  - "[code://packages/agents/src/run/resume.ts#L134-L139](../../../../packages/agents/src/run/resume.ts#L134-L139) - crash recovery answers a cut batch with its own fixed text"
  - "[code://packages/agents/README.md#L72](../../../../packages/agents/README.md#L72) - the README line that names the texts and says a timeout writes the same"
  - "[code://packages/papo/src/chat.ts#L550-L568](../../../../packages/papo/src/chat.ts#L550-L568) - papo cancels a person's stop with `reason: 'cancelled by the user'`"
  - "[code://packages/papo/src/turns.ts#L189-L192](../../../../packages/papo/src/turns.ts#L189-L192) - papo shows the marker as a notice only when it equals `INTERRUPTED`"
  - file:///github/ahpd/packages/agent-cofold/src/session.ts - `close` stops the turn with `'the session closed'`, and a client stop with `'the client stopped the turn'`
  - file:///github/ahpd/packages/agent-cofold/src/pauses.ts - `stopNow` passes that reason to `handle.cancel({ reason })`
---

## Goal

A turn that the harness cuts says why in the transcript.
Today every abort writes `[Request interrupted by user]`, so a turn that `ahpd restart --force` stopped, or a timeout, reads as a person's stop.
The caller chooses the text, and the harness has defaults that say the reason when it has one.

## Reconnaissance

### Searches performed

- `rg "INTERRUPTED" packages` - one writer, `interrupt` in `turn.ts`; papo compares the marker to `INTERRUPTED` in `turns.ts`; papo's Claude backend has its own copy for the CLI.
- `rg "cancel\(" packages/papo/src` - papo cancels with `'cancelled by the user'`, `'session removed'` and `'papo closed'`.
- `rg "cancel|stop" /github/ahpd/packages/agent-cofold/src` - ahpd cancels with `'the client stopped the turn'`, `'the session closed'`, and `'the session closed'` on a reopened run.
- `rg "not executed" packages/agents/src` - one text, in `resume.ts` crash recovery, which runs with no abort.

### Runtime path

```
handle.cancel({ reason }) / signal / timeoutMs -> RunAbort.reason() -> interrupt(ctx, calls, from) -> tool results + marker message -> transcript
```

### Gaps

- `interrupt` does not read `ctx.abort.reason()`; only the outcome does.
- No run option sets the texts.
- `interrupt.test.ts` has no case for a timeout's texts or a reasoned cancel's texts.

## Answers

| What | Source | Task |
| --- | --- | --- |
| cofold does not hard code the reason a turn was cut | Softov, 2026-10-14, asked "A turn stopped by `ahpd restart --force` reads `[Request interrupted by user]`... What should happen?": "cofold should be able to be 'flexible' so yes fix cofold so it does not hard code reasons and things like that." | 01 |
| The caller sets the texts with a run option, and the harness has defaults | Softov, 2026-10-14, asked "How should cofold choose the text it writes when a turn is cut off?": "Caller sets it, with defaults" | 01 |
| The option is `interrupted(abort)` on `RunArgs`, `CompactArgs` and `ResumeArgs`, and returns `{ turn, tool }` | (defaulted: a resumed run that waits at a pause is cancelled too, as ahpd does on close) | 01 |
| A cancel with no reason writes `INTERRUPTED` and `INTERRUPTED_TOOL`, which stay exported | Softov, 2026-10-14, same answer | 01 |
| A cancel with a reason writes `[Request interrupted: <reason>]` | Softov, 2026-10-14, same answer, "for example `[Request interrupted: restart]`" | 01 |
| A reasoned cancel's tool text is `[Request interrupted for tool use: <reason>]` | (defaulted: the turn text's shape, with the words of `INTERRUPTED_TOOL`) | 01 |
| A timeout writes `[Request interrupted: timeout]` and `[Request interrupted for tool use: timeout]` | (defaulted: the outcome's own word, `stopped { reason: 'timeout' }`) | 01 |
| The defaults are exported as `interruptedText(abort)`, so a caller can wrap them | (defaulted: a caller that changes one case keeps the others) | 01 |
| Crash recovery keeps its own text and is not part of the option | (defaulted: it runs with no abort and no caller; see Risks) | - |
| No changelog entry; a release is a version bump in `package.json` | the commits `agents goes to 0.3.0` and `yaml 0.3.0` | - |

## Proposed architecture

- **Data flow** - `run`, `compact` and `resume` put `args.interrupted ?? interruptedText` on the turn context. `interrupt` calls it with `ctx.abort.reason()` and writes the two texts.
- **Layer responsibilities** - agents: the option, the defaults and the write. papo and ahpd: the reason they pass, and the option if they want other words.
- **Source-of-truth files** - [`code://packages/agents/src/message/markers.ts`](../../../../packages/agents/src/message/markers.ts) holds the defaults; [`code://packages/agents/src/types/abort.ts`](../../../../packages/agents/src/types/abort.ts) holds the types.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The caller chooses what a cut turn says](task-01-the-caller-chooses-what-a-cut-turn-says.md) | todo | - |

## Risks and tradeoffs

- A caller that passes a reason today gets new words. It needs no change for that. papo's stop passes `'cancelled by the user'`, so it would read `[Request interrupted: cancelled by the user]`, and papo's notice check would stop matching. See open question 1.
- An external `AbortSignal` cancels with the harness's own `reason: 'signal'`, so it would read `[Request interrupted: signal]`. See open question 2.
- Crash recovery in `resume.ts` writes `not executed: the run was interrupted` and `execution outcome unknown: the process died during the call`. No abort and no caller exist at that point, so the option does not reach it. If those texts must be settable too, that is a second option on `ResumeArgs`, in its own plan.

## Resume state

- **Done so far:** the plan, 2026-10-14.
- **Next action:** answer the open questions, then [task-01-the-caller-chooses-what-a-cut-turn-says.md](task-01-the-caller-chooses-what-a-cut-turn-says.md).
- **Open questions:**
  1. papo's stop passes `'cancelled by the user'`. Does papo keep `[Request interrupted by user]`, or show the new text? - proposed: papo passes `interrupted` and keeps its text.
  2. An external `AbortSignal` cancels with the harness's own `'signal'`. Is that a reason, or a plain cancel? - proposed: a plain cancel, because `'signal'` says how the cancel came, not why.
- **Watch out for:** the plan number 08 is taken by the event order plan, so this plan is 09.

## Final verification checklist

- [ ] A cancel with no reason writes `INTERRUPTED` and `INTERRUPTED_TOOL`.
- [ ] A cancel with a reason and a timeout write the reason.
- [ ] `interrupted` replaces both texts on `run`, `compact` and `resume`.
- [ ] `pnpm typecheck` and `pnpm test` pass.
- [ ] `plans/index.md` updated.
