# @facio/model-openai-compat

Non-streaming Chat Completions adapter for `@facio/agents`.
One function, `openaiCompat({...})`, returns a `ModelAdapter`; the target server is configuration only.

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

## Options

| Option | Default | What |
| --- | --- | --- |
| `baseUrl` | required | `<baseUrl>/chat/completions` is called |
| `model` | required | Provider model id; also the adapter's `modelId` |
| `apiKey` | none | Sent as `Authorization: Bearer <key>` |
| `headers` | `{}` | Extra request headers (e.g. OpenRouter's `HTTP-Referer`) |
| `features` | `{ tools: true, streaming: false, images: false, structuredOutput: false }` | What the model actually supports; the adapter refuses a request that needs more |
| `params` | `{}` | Default `ModelParams`; the request's own params win |
| `retries` | `2` | Retries on `429`, `5xx` and network errors, exponential backoff from 500 ms |
| `fetch` | global `fetch` | Injection point for tests |

## Behavior

- Tool calls come back as `toolCall` parts with `input` parsed from `function.arguments`; when the arguments are not JSON, `input` is `undefined` and `raw` keeps the string. The adapter never throws on model-produced JSON.
- `4xx` other than `429` is never retried: `401`/`403` → `ModelError('auth')`, the rest → `ModelError('invalid_response')` with `status`.
- The request `signal` aborts the HTTP call and any pending backoff with `ModelError('aborted')`.
- `tool_choice: 'auto'` is sent whenever the request carries tools; set `features.tools: false` for models that reject it.
- `reply.raw` holds the provider body for diagnostics; it is never sent back to the model.
