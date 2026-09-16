# CLAUDE.md

facio is a TypeScript (pnpm) workspace for one family of packages: the command framework (`@facio/commands` and its surfaces), the agent harness (`@facio/agents` and its adapters and stores), papo (`@facio/papo`, the harness in a terminal), and later the program that composes them (`facio`, the daemon and its CLI).

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
packages/sdk/               @facio/sdk - what commands and agents share: JsonSchema, the one validator (validateSchema, assertSupportedSchema), SchemaResult, StandardSchema; one thing per file
packages/commands/          @facio/commands - the declaration, registry, input, argv grammar, coercion, the sentence a validation failure becomes
  src/types/                contracts only, grouped by concept: coerce, field, command, input, argv, context, registry, errors, compact
  src/<name>.ts             runtime by domain (command, registry, context, input, coerce, schema, argv, errors, compact, display, suggest)
packages/{terminal,mcp,remote,config,yaml,docs}/   the surfaces; each depends on @facio/commands (mcp: optional SDK peer)
packages/agents/            @facio/agents  - contracts, loop, run handle, step log, memory store, fake model
  src/types/                contracts only, grouped by concept
  src/{agent,message,model,store,tool,run,capabilities,testing}/   runtime code by domain
packages/model-openai-compat/   Chat Completions adapter (OpenRouter, LM Studio)
packages/store-file/        durable Store on the filesystem
packages/tools/            @facio/tools: files, shell, web and memory as capabilities; what papo turns on
packages/papo/              @facio/papo, binary `papo`: the harness in this process as a screen (@textui/chat) and a shell (@facio/commands actions on @facio/terminal)
  src/{chat,turns,blocks,questions,config,agent,commands,program,main}.ts   the service, the projection, the shell
  src/screen/               the textui application (state paths, controller, two screens, terminal boot)
packages/facio/             later: the program (daemon + CLI), not yet created
examples/commands/          the framework's example programs (petshop, kitchen-sink, clerver, open-cli, mcp-server)
examples/agents/            hosts that use the harness
docs/commands/  docs/agents/
roadmap/plans/{agent,cli,commands}/
```

Every package: `package.json` with `exports`, `tsconfig.json` extending `../../tsconfig.base.json`, `tsc -p` build, its own `README.md` and `LICENSE`; `files` never reaches outside the package folder.

## Rules that are easy to get wrong

- **One definition, declared once.** A shape two packages need lives in `@facio/sdk`; never keep two copies and bridge them, never add a wrapper or adapter between facio packages. The same holds against textui: papo maps the store onto `@textui/chat`'s prop types and declares no seam of its own.
- **Zero third-party runtime dependencies per package.** Own JSON Schema validator, native `fetch`, `crypto.randomUUID`. The framework runs unmodified on Node, Bun and Deno. Optional peers are the exception, imported lazily and named when absent: `@facio/mcp`'s SDK server, and `@anthropic-ai/claude-agent-sdk` for papo's `--backend claude`. papo depends on `@textui/*` (published; linked from the sibling checkout until 0.6.0), and facio never depends the other way round.
- **Every exported `interface` and `type` lives in its package's `src/types/`, grouped by concept** (the sdk, one thing per file at its root, is the exception). A file there never exports a `const` or `function`. Runtime files import from `../types/<concept>.js`, never from the `types/index.ts` barrel.
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
