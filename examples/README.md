# Examples

Hosts that use the harness.
Build the packages first (`pnpm build` at the repo root); the examples import the published entry points.

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
