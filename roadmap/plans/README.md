# roadmap/plans - development plans

Long-lived development documentation for **facio-agents**.
Every plan here is implementation-ready: enough for a developer or a fresh AI session to execute the work without re-deriving intent.

Plans follow the same loop as opendoop, **scout → plan → do it** (`/dooscout`, `/dooplan`, `/dooit`), and the same shape (`_TEMPLATE.md`).

## Day zero

This tree starts on **2026-09-13**.
The source material is `roadmap/specs/agent-harness-spec.md` (the runtime specification) and `roadmap/research/agent-harness-survey.md` (what the field has).

## Layout

```
roadmap/
  specs/               specifications this repo implements
  research/            surveys and references
  plans/
    README.md          this file
    _TEMPLATE.md       the shape every plan follows
    index.md           master index by domain (link, priority, status, deps)
    <domain>/
      00-<domain>.md   current-code reference for the domain (what exists today)
      NN-<slug>.md     a single plan
      NN-<slug>-pN-... child plans of a split plan (parent NN holds the phase map)
```

Domains for this repo: `agent` (core contracts + loop) · `model` (adapters) · `store` · `tools` · `memory` · `transport` (ahpd, JSON-RPC, WS/HTTP, MCP server) · `network` (multi-agent) · `testing` · `documentation`.
Create a domain folder with its `00-<domain>.md` stub when the first plan for it is written.

## Rules

- **Numbering.** Per domain, sequential, zero-padded. `00-<domain>.md` is the reference layer. Check `index.md` for the next free number.
- **One concept, one type.** Contracts live in `packages/agent/src/` and every other package imports them. Plans reference that file; they never redefine a shared shape.
- **Decisions are written down.** Every plan has a *Decisions locked in* table. Nothing is decided silently. An undecided fork during implementation means stop and ask, then amend the table.
- **Splitting.** Large work (more than ~6-8 tasks, more than 3 phases, or more than two packages) becomes a parent index plus numbered children, each finishable and resumable on its own.
- **Status and resume.** Plans carry a status in the header and a *Resume state* block. Markers: `Not started` · `In progress` · `Blocked` · `Partial` · `Shipped`.
- **Style.** Single-object factories (`createAgent({...})`, `createTool({...})`), no classes except errors, `@facio/agent` has zero runtime dependencies. See the parent plan's Decisions table.

## Lifecycle

`Not started` → `In progress` → `Shipped`.
When a plan ships, update its status in `index.md` and its header; keep the file as a record.
