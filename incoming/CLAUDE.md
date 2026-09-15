# CLAUDE.md

facio-agents is a TypeScript (pnpm) monorepo for an agent harness: a model conducts a conversation, proposes tools, the runtime authorizes and executes them, one turn is a run.
Core package: **`@facio/agents`** (`packages/agents/`). Adapters and stores are sibling packages under `@facio/*`.

Plans live in `roadmap/plans/` and are the source of truth for what to build.
Read the parent plan `roadmap/plans/agent/01-harness-core.md` (its *Decisions locked in* table) before touching code, then the child plan for the phase you are on.
The spec is `roadmap/specs/agent-harness-spec.md`.

## Commands

```bash
pnpm install
pnpm typecheck          # tsc --noEmit in every workspace
pnpm test               # vitest run --typecheck (also runs *.test-d.ts)
pnpm check              # typecheck + test
pnpm --filter @facio/agents test
```

pnpm only (`packageManager` is pinned). Node >= 22. ESM only. No bundler.

## Layout

```
packages/agents/            @facio/agents  - contracts, loop, run handle, step log, memory store, fake model
  src/types/                contracts only: interfaces and type aliases, no runtime values
  src/{agent,message,model,schema,store,tool,testing}/   runtime code by domain
  src/index.ts              public entry; src/testing.ts is the "./testing" sub-path
packages/model-openai-compat/   Chat Completions adapter (OpenRouter, LM Studio)
packages/store-file/        (p3) durable Store on the filesystem
examples/                   hosts that use the harness
roadmap/plans/              plans; roadmap/plans/index.md is the status index
```

## Rules that are easy to get wrong

- **`@facio/agents` has zero runtime dependencies.** Own JSON Schema subset, native `fetch`, `crypto.randomUUID`. No `node:` imports in the core either; hosts and store packages own I/O.
- **`src/types/` holds contracts only.** A file there never exports a `const` or `function`. Runtime files import from `../types/<name>.js`, never from the `types/index.ts` barrel.
- **Factories, one options object, one return value.** `createTool({...})`, `createAgent({...})`, `run({...})`. No classes except `Error` subclasses. Hooks take one named args object (`BeforeToolArgs`) and return one result.
- **The one positional exception:** `Tool.execute(input, ctx)`. Input first.
- **Agent is a value, run is the harness.** `createAgent` returns a frozen `Agent` with no methods; `run({ agent, session, input })` executes one turn; `resume({ agent, sessionId, runId })` re-attaches.
- **Runs live under their session.** Every run-level store call carries `RunRef { sessionId, runId }`. No run index, no scanning.
- **Workspace is a host-supplied key** (`SessionRecord.workspace`). The core never reads `process.cwd()` or `os.homedir()`.
- **Capabilities** (`{ id, tools?, instructions? }`) are the only slot that adds tools plus prompt text; resolved per run. Skills are a core capability over `SkillSource`; MCP is a separate client package.
- **Hooks are not the security boundary.** The loop enforces the final decision right before executing a tool.
- **Outcomes are explicit:** `completed | awaiting | stopped | cancelled | failed`. Never one "done".
- **Records must serialize.** `exactOptionalPropertyTypes` is on; never store an `undefined` field, spread conditionally.
- Let real failures stop with a useful error. No broad catches, no silent defaults. Comment only the non-obvious.

## Working a plan

- Execute one task at a time, in the plan's order. The plan's code blocks are the intended implementation; deviate only when the code proves the plan wrong, and then say so in the report.
- A plan's *Decisions* table is locked. On a fork the plan does not cover, stop and ask; do not pick.
- Update the plan's *Resume state* and `roadmap/plans/index.md` status when a phase moves.

## Git

Read-only by default (`status`, `log`, `diff`, `show`).
The user owns commits, branches, and history: do not commit, push, reset, checkout, rebase, or merge unless told to.

## When done, report

1. Files changed. 2. What changed. 3. Checks run and results. 4. Checks not run and why. 5. Where the code deviated from the plan, and remaining follow-up.
Keep it factual; do not overclaim.
