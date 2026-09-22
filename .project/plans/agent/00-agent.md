---
title: AGENT-00 - Reference: what exists today
domain: agent
revalidated: 2026-09-13
---

# AGENT-00 - Reference: what exists today

This file describes the current state of the `agent` domain so plans can point at it instead of re-deriving it.
Update it when a plan ships.

## Code in this repo

`packages/agents` (`@doopx/agents`), `packages/store-file`, `packages/model-openai-compat`, `examples/agents`, `docs/agents`: harness phases p1-p3 of [01-harness-core.md](01-harness-core/plan.md) shipped; p5 is planned in part.

## Inputs the domain is built from

| Source | Location | What it fixes |
| --- | --- | --- |
| Runtime specification | `.project/specs/agent-harness-spec.md` | Vocabulary (definition / session / turn / step / tool call / hook / event / command), public shape (run handle), turn lifecycle, model adapter rules, tool rules, context assembly, persistence and recovery, ahpd integration, build sequence |
| Field survey | `.project/research/agent-harness-survey.md` | What 24 harnesses have; which features are table stakes and which are differentiators |
| ahpd contracts | `ahpd/packages/sdk/src/types/agent.ts`, `session.ts` (softov/ahpd) | The `Agent` / `Session` / `BoundTool` / `Start` shapes the p4 adapter must implement |
| doopx | `F:\github\doopx\src\core\command.ts` | `ActionDefinition` (id, summary, `input` as JSON Schema fields, `surfaces`, `needs`, `run`) that `fromDoopxAction()` will map onto `createTool()`; tooling style (tsc build, vitest, zero deps) |
| opendoop / pood | `opendoop/pood/src/runtime/agents/agent-worker.ts`, `opendoop/packages/sdk/src/provider/tool.ts` | Reference for iteration outcomes, tool effects, loop guards, `ToolManifest` fields; not copied, read for shape |
| Prior art (see `.project/research/agent-harness-survey.md`) | public harnesses surveyed there | Event union style, canonical-transcript vs derived-model-view split, writer fence idea |

## Vocabulary (from the spec, used verbatim in every plan)

| Term | Meaning |
| --- | --- |
| Agent definition | Serializable configuration: id, instructions, model id, tool names, limits |
| Agent | `createAgent({...})` result: a frozen value holding the definition plus bound model, tools, store, hooks, limits, resources. No methods |
| run() | Standalone function `run({ agent, session, input })` that executes one turn of an agent and returns a run handle. The harness runs the agent; the agent does not run itself |
| Session | Durable conversation identity and transcript, keyed by `sessionId` |
| Run | One turn: one input, N model steps, M tool calls, one outcome |
| Model step | One request to the model adapter and its reply |
| Tool call | A model-proposed invocation (`callId`); never executed by the model |
| Invocation | One actual execution attempt of a tool call (`invocationId`), recorded in the step log |
| Hook | Application code that inspects or changes a planned operation and returns a decision |
| Event | Immutable, seq-numbered report of something that happened in a run |
| Command | External input into a running or paused run (approve, deny, answer, cancel) |
| Run handle | What `run()` returns: id, status, events, submit, cancel, outcome |

## Package family

Published under `@doopx/*`.
The agent core is `@doopx/agents`; `doopx` (the command framework) stays a separate package and is never imported by the core.

```
packages/
  agents/                 @doopx/agents            contracts, loop, run handle, step log, memory store, fake model
  model-openai-compat/    @doopx/model-openai-compat
  store-file/             @doopx/store-file       (p3) first durable store: JSONL per session and run
  store-sqlite/           @doopx/store-sqlite     later, same Store contract
  transport-ahp/          @doopx/transport-ahp    (p4)
  tools-*/ memory-*/ mcp-*/ transport-*/           later plans
examples/
```
