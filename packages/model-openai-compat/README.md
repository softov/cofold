# @facio/model-openai-compat

Chat Completions adapter for `@facio/agents`, streaming by default.
`openaiCompatProvider({...})` returns a `ModelProvider` (catalog + adapter factory); `openaiCompat({...})` is the one-model shortcut.
The target server is configuration only.

```ts
import { openaiCompat } from '@facio/model-openai-compat';

// LM Studio (no key)
const local = openaiCompat({ baseUrl: 'http://localhost:1234/v1', model: 'qwen/qwen3-8b' });

// OpenRouter
const hosted = openaiCompat({
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4o-mini',
  apiKey: process.env.OPENROUTER_API_KEY,
  features: { images: true },
});
```

## Catalog

```ts
import { openaiCompatProvider } from '@facio/model-openai-compat';

const provider = openaiCompatProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey, name: 'openrouter' });
const models = await provider.listModels();      // GET <baseUrl>/models
const model = provider.model({ id: models[0].id }); // a ModelAdapter
```

`listModels()` returns `ModelInfo[]`: `id`, `name`, best-effort `features`, and, when the server reports them (OpenRouter does), `contextTokens`, `maxOutputTokens` and `pricing` in USD per million tokens (`prompt` / `completion`, plus `input_cache_read` / `input_cache_write` as the cache rates when present).
`model()` is synchronous and looks nothing up: pass the catalogue entry's `pricing` through (`provider.model({ id, pricing: info.pricing })`) and the adapter carries it as `pricing`, so every run records its `cost`; without it the cost is unknown and `limits.maxCost` never trips.
LM Studio only reports ids, so every entry gets the default features; override them in `model({ id, features })`.

## Options

| Option | Default | What |
| --- | --- | --- |
| `baseUrl` | required | `<baseUrl>/chat/completions` is called |
| `model` | required | Provider model id; also the adapter's `modelId` |
| `apiKey` | none | Sent as `Authorization: Bearer <key>`; a string, or a function called once per request attempt (so a retry gets a fresh token) whose result is never cached |
| `headers` | `{}` | Extra request headers (e.g. OpenRouter's `HTTP-Referer`) |
| `reasoningBudgets` | `{}` | Token budget per effort level (`{ xhigh: 32000 }`) for providers that take `max_tokens` instead of a level |
| `features` | `{ tools: true, streaming: true, images: false, structuredOutput: false, reasoning: false }` | What the model actually supports; the adapter refuses a request that needs more, and `streaming: false` makes the loop call `complete()` instead of `stream()` |
| `params` | `{}` | Default `ModelParams`; the request's own params win |
| `pricing` | none | `ModelPricing` in USD per million tokens, set on the adapter; the loop records `cost` from it. Take it from `listModels()`; LM Studio reports none |
| `retries` | `2` | Retries on `429`, `5xx` and network errors, exponential backoff from 500 ms |
| `name` | URL host | Suffix of the provider id, `openai-compat:<name>` |
| `fetch` | global `fetch` | Injection point for tests |

## Behavior

- Tool calls come back as `toolCall` parts with `input` parsed from `function.arguments`; when the arguments are not JSON, `input` is `undefined` and `raw` keeps the string. The adapter never throws on model-produced JSON.
- `4xx` other than `429` is never retried: `401`/`403` → `ModelError('auth')`, the rest → `ModelError('invalid_response')` with `status`.
- The request `signal` aborts the HTTP call and any pending backoff with `ModelError('aborted')`.
- `tool_choice: 'auto'` is sent whenever the request carries tools; set `features.tools: false` for models that reject it.
- `reply.raw` holds the provider body for diagnostics; it is never sent back to the model.
- Reasoning: with `features.reasoning: true`, `params.reasoning.effort` (`minimal | low | medium | high | xhigh | max`) is sent as `reasoning_effort`; as soon as `maxTokens` is set it becomes OpenRouter's `reasoning: { effort, max_tokens }`, and an effort with an entry in `reasoningBudgets` becomes `reasoning: { max_tokens }`. A level the provider does not accept is the provider's error (`invalid_response` / `server`), never clamped here. On reply, `message.reasoning` (OpenRouter), `message.reasoning_content` (DeepSeek, LM Studio) or a leading `<think>...</think>` block in `content` becomes a `reasoning` part placed before the text; `usage.reasoningTokens` comes from `completion_tokens_details.reasoning_tokens`. Reasoning parts are never sent back.
- `content` returned as an array of parts is accepted; its text parts are joined.
- `request.cacheKey` (the session id, set by the loop) is sent as `prompt_cache_key`, so a provider-side prompt cache follows the session.
- Streaming: the adapter has `stream(request)` and `features.streaming` is `true` by default, so the loop streams every model step (the compaction summary step never does). The request is the same as `complete()`'s plus `stream: true, stream_options: { include_usage: true }`; the body is read as server-sent events with the package's own parser. `delta.content` goes out as `text.delta` as it arrives (a leading `<think>...</think>` block is split into `reasoning.delta` at chunk boundaries, the same result as the whole-response rule), `delta.reasoning` / `delta.reasoning_content` as `reasoning.delta`, and every `tool_calls` fragment as `toolCall.delta { index, callId?, name?, arguments }`; the tool calls are assembled by `index` and appear whole only in the final `done { reply }`, built by the same rules as `complete()`'s reply (`raw` is the list of chunks; `usage` comes from the chunk that carries it, zeros without `include_usage`). Connection errors, `429` and `5xx` before the body are retried like `complete()`; once the body is being read nothing is retried: a broken connection is `ModelError('network')` (or `aborted` when the signal fired) and no `done` is yielded, so no partial call can run twice.
