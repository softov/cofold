# CLAUDE.md

facio is a TypeScript (pnpm) workspace for one family of packages: the command framework (`@facio/commands` and its surfaces), the agent harness (`@facio/agents` and its adapters and stores), and later the program that composes them (`facio`, the daemon and its CLI).

Plans live in `roadmap/plans/` and are the source of truth for what to build; `roadmap/plans/index.md` is the status index.
Read a domain's `00-<domain>.md` and the plan's *Decisions locked in* table before touching code.
The agent harness spec is `roadmap/specs/agent-harness-spec.md`; the framework's open items are in `ROADMAP.md`.

## Commands

```bash
pnpm install
pnpm build              # every package, workspace order
pnpm typecheck          # build, then tsc --noEmit in every package and example
pnpm test               # build + examples, then vitest run --typecheck (also runs *.test-d.ts)
pnpm check              # typecheck + test
pnpm examples           # build the example programs against the built packages
pnpm --filter @facio/agents test
```

pnpm only (`packageManager` is pinned). Node >= 22. ESM only. No bundler. Tests import a package by its published name and resolve through `dist`, so build before test.

## Layout

```
packages/commands/          @facio/commands - the declaration, registry, input, argv grammar, coercion, schema
  src/types/                contracts only, grouped by concept: json-schema, standard-schema, coerce, field, command, input, argv, context, registry, errors, compact
  src/<name>.ts             runtime by domain (command, registry, context, input, coerce, schema, argv, errors, compact, display, suggest)
packages/{terminal,mcp,remote,config,yaml,docs}/   the surfaces; each depends on @facio/commands only (mcp: optional SDK peer)
packages/facio/             later: the program (daemon + CLI), not yet created
packages/agents/            @facio/agents  - contracts, loop, run handle, step log, memory store, fake model
  src/types/                contracts only: interfaces and type aliases, no runtime values
  src/{agent,message,model,schema,store,tool,run,capabilities,testing}/   runtime code by domain
packages/model-openai-compat/   Chat Completions adapter (OpenRouter, LM Studio)
packages/store-file/        durable Store on the filesystem
examples/commands/          the framework's example programs (petshop, kitchen-sink, clerver, open-cli, mcp-server)
examples/agents/            hosts that use the harness
docs/commands/  docs/agents/
roadmap/plans/{repo,agent,cli,commands}/
```

Every package: `package.json` with `exports`, `tsconfig.json` extending `../../tsconfig.base.json`, `tsc -p` build, its own `README.md` and `LICENSE`; `files` never reaches outside the package folder.

## Rules that are easy to get wrong

- **Zero runtime dependencies per package.** Own JSON Schema subset, native `fetch`, `crypto.randomUUID`. The framework runs unmodified on Node, Bun and Deno. `@facio/mcp`'s SDK server is the one optional peer.
- **`src/types/` holds contracts only** (agents and commands). A file there never exports a `const` or `function`. Runtime files import from `../types/<name>.js`, never from the `types/index.ts` barrel.
- **Factories, one options object, one return value.** `createTool({...})`, `createAgent({...})`, `run({...})`, `createRegistry()`. No classes except `Error` subclasses. Hooks take one named args object and return one result.
- **The one positional exception:** `Tool.execute(input, ctx)`. Input first.
- **Agent is a value, run is the harness.** `createAgent` returns a frozen `Agent` with no methods; `run({ agent, session, input })` executes one turn; `resume({ agent, sessionId, runId })` re-attaches.
- **Runs live under their session.** Every run-level store call carries `RunRef { sessionId, runId }`. No run index, no scanning.
- **Workspace is a host-supplied key** (`SessionRecord.workspace`). The agents core never reads `process.cwd()` or `os.homedir()`.
- **Capabilities** (`{ id, tools?, instructions? }`) are the only slot that adds tools plus prompt text; resolved per run. Skills are a core capability over `SkillSource`; MCP is a separate client package.
- **Hooks are not the security boundary.** The loop enforces the final decision right before executing a tool.
- **Outcomes are explicit:** `completed | awaiting | stopped | cancelled | failed`. Never one "done".
- **A command is data** (framework). `registry.action` is the way in; every surface (terminal, MCP, HTTP, docs) is a rendering of the declaration, never a second declaration.
- **Records must serialize.** `exactOptionalPropertyTypes` is on; never store an `undefined` field, spread conditionally.
- Let real failures stop with a useful error. No broad catches, no silent defaults. Comment only the non-obvious.

## Working a plan

- Execute one task at a time, in the plan's order. The plan's code blocks are the intended implementation; deviate only when the code proves the plan wrong, and then say so in the report.
- A plan's *Decisions* table is locked. On a fork the plan does not cover, stop and ask; do not pick.
- Update the plan's *Resume state* and `roadmap/plans/index.md` status when a phase moves.

## Git

Read-only by default (`status`, `log`, `diff`, `show`).
The user owns commits, branches, and history: do not commit, push, reset, checkout, rebase, or merge unless told to.
Never add a co-author line.

## When done, report

1. Files changed. 2. What changed. 3. Checks run and results. 4. Checks not run and why. 5. Where the code deviated from the plan, and remaining follow-up.
Keep it factual; do not overclaim.
