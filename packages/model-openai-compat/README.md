# @facio/model-openai-compat

Non-streaming Chat Completions adapter for `@facio/agents`.
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

`listModels()` returns `ModelInfo[]`: `id`, `name`, best-effort `features`, and, when the server reports them (OpenRouter does), `contextTokens`, `maxOutputTokens` and `pricing` per million tokens.
LM Studio only reports ids, so every entry gets the default features; override them in `model({ id, features })`.

## Options

| Option | Default | What |
| --- | --- | --- |
| `baseUrl` | required | `<baseUrl>/chat/completions` is called |
| `model` | required | Provider model id; also the adapter's `modelId` |
| `apiKey` | none | Sent as `Authorization: Bearer <key>`; a string, or a function called once per request attempt (so a retry gets a fresh token) whose result is never cached |
| `headers` | `{}` | Extra request headers (e.g. OpenRouter's `HTTP-Referer`) |
| `reasoningBudgets` | `{}` | Token budget per effort level (`{ xhigh: 32000 }`) for providers that take `max_tokens` instead of a level |
| `features` | `{ tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false }` | What the model actually supports; the adapter refuses a request that needs more |
| `params` | `{}` | Default `ModelParams`; the request's own params win |
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
