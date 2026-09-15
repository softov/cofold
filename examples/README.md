# Examples

Hosts that use the harness.
Build the packages first (`pnpm build` at the repo root); the examples import the published entry points.
Every script loads `../.env` when it exists (`node --env-file-if-exists`, Node >= 22.9), so put `FACIO_BASE_URL`, `FACIO_MODEL` and `FACIO_API_KEY` there instead of exporting them; `.env` is git-ignored.

## adapter-smoke

Calls a Chat Completions model once with one tool and prints the reply, usage and tool calls.

```bash
pnpm --filter facio-agents-examples smoke
```

| Variable | Default | Notes |
| --- | --- | --- |
| `FACIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio; use `https://openrouter.ai/api/v1` for OpenRouter |
| `FACIO_MODEL` | `qwen/qwen3-8b` | Provider model id |
| `FACIO_API_KEY` | none | Required for OpenRouter, unused by LM Studio |

Known-good targets:

- LM Studio, any tool-capable model, no key: prints `finish: tool_calls` and one `now({})` call.
- OpenRouter with `FACIO_API_KEY` set: same output for a tool-capable model.

With a model that has no tool support the script prints `finish: stop` and a text answer; neither run throws.

## standalone

Fake model plus one tool through `createAgent` and `run`; prints every event and the outcome.
No server needed.

```bash
pnpm --filter facio-agents-examples standalone
```

Expected: seq 1..9 (`run.started` ... `run.finished`) and `completed The tool said: hello`.

## lmstudio-tools

The same loop against a real Chat Completions model with the `now` tool; `hooks.onEvent` prints the `tool.*` events with their payloads.
Same env vars as `adapter-smoke`.

```bash
pnpm --filter facio-agents-examples lmstudio-tools
```

Expected with a tool-capable model: a `tool.completed` for `now` and a `completed` outcome whose text contains the time.
