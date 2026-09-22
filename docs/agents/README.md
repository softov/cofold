# doopx agents

An agent harness in TypeScript: a model conducts a conversation, proposes tools, the runtime authorizes and executes them, one turn is a run.

| Package | What |
| --- | --- |
| [`@doopx/agents`](../../packages/agents) | Contracts, JSON Schema validation, `createTool`, `createAgent`, `run`, `resume`, capabilities, skills and deferred tools, the step log, in-memory store, fake model. |
| [`@doopx/store-file`](../../packages/store-file) | The durable `Store` on the filesystem: sessions, runs, requests, a writer lease. |
| [`@doopx/model-openai-compat`](../../packages/model-openai-compat) | Non-streaming Chat Completions adapter (OpenRouter, LM Studio, any compatible server). |
| [`examples/agents/`](../../examples/agents) | Hosts that use the harness. |

## Develop

```bash
pnpm install
pnpm build       # emit dist/ for every package
pnpm typecheck   # build, then tsc --noEmit in every workspace
pnpm test        # build, then vitest run --typecheck
pnpm check       # typecheck + test
```

Sibling packages import `@doopx/agents` through its published `exports` (`dist/`), so `typecheck` and `test` build first.

Node >= 22, pnpm only, ESM only, no bundler.
Plans live in `roadmap/plans/`; `roadmap/plans/index.md` is the status index.
