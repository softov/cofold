import { ModelError } from '@facio/agents';
import type { ModelAdapter, ModelFeatures, ModelInfo, ModelParams, ModelProvider, ModelRequest } from '@facio/agents';
import { fromWireModel, fromWireResponse, toWireMessages, toWireReasoning, toWireTools } from './wire.js';
import type { WireModelList, WireResponse } from './wire.js';

const DEFAULT_FEATURES: ModelFeatures = { tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false };

export interface OpenAICompatProviderOptions {
  /** e.g. 'http://localhost:1234/v1' or 'https://openrouter.ai/api/v1' */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Provider id suffix; defaults to the URL host. */
  name?: string;
  /** Retries on 429, 5xx and network errors; default 2. */
  retries?: number;
  /** Injection for tests. */
  fetch?: typeof fetch;
}

export interface OpenAICompatOptions extends OpenAICompatProviderOptions {
  /** Provider model id. */
  model: string;
  features?: Partial<ModelFeatures>;
  params?: ModelParams;
}

/** One-model shortcut over openaiCompatProvider(...).model(...). */
export function openaiCompat(options: OpenAICompatOptions): ModelAdapter {
  const { model, features, params, ...provider } = options;
  return openaiCompatProvider(provider).model({
    id: model,
    ...(features !== undefined ? { features } : {}),
    ...(params !== undefined ? { params } : {}),
  });
}

export function openaiCompatProvider(options: OpenAICompatProviderOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

  /** POST/GET with the retry policy of decision 32; returns the parsed JSON body of a 2xx. */
  async function send(url: string, init: { method: 'GET' | 'POST'; body?: string }, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { ...init, headers, signal });
      } catch (e) {
        if (signal.aborted) throw new ModelError({ code: 'aborted', message: 'request aborted', cause: e });
        if (attempt < retries) { await backoff(attempt, signal); continue; }
        throw new ModelError({ code: 'network', message: `fetch failed: ${(e as Error).message}`, cause: e, retryable: true });
      }
      if (res.ok) {
        try { return await res.json(); }
        catch (e) { throw new ModelError({ code: 'invalid_response', message: 'response is not JSON', cause: e }); }
      }
      const text = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) { await backoff(attempt, signal); continue; }
      throw new ModelError({
        code: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'invalid_response',
        message: `${res.status} from ${url}: ${text.slice(0, 500)}`,
        status: res.status,
        retryable,
        detail: text,
      });
    }
  }

  return {
    id: `openai-compat:${options.name ?? new URL(baseUrl).host}`,

    async listModels(args): Promise<ModelInfo[]> {
      const signal = args?.signal ?? new AbortController().signal;
      const body = (await send(`${baseUrl}/models`, { method: 'GET' }, signal)) as WireModelList;
      if (!Array.isArray(body?.data)) {
        throw new ModelError({ code: 'invalid_response', message: 'model list has no data[]', detail: body });
      }
      return body.data.map((m) => fromWireModel(m, DEFAULT_FEATURES));
    },

    model(args): ModelAdapter {
      const features: ModelFeatures = { ...DEFAULT_FEATURES, ...args.features };
      const url = `${baseUrl}/chat/completions`;
      return {
        id: `openai-compat:${args.id}`,
        modelId: args.id,
        features,
        async complete(request: ModelRequest) {
          if (request.tools.length > 0 && !features.tools) {
            throw new ModelError({ code: 'unsupported_feature', message: `${args.id} does not support tools` });
          }
          let messages;
          try { messages = toWireMessages(request, features); }
          catch (e) { throw new ModelError({ code: 'unsupported_feature', message: (e as Error).message, cause: e }); }
          const params = { ...args.params, ...request.params };
          const body = {
            model: args.id,
            messages,
            ...(request.tools.length ? { tools: toWireTools(request), tool_choice: 'auto' } : {}),
            ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
            ...(params.topP !== undefined ? { top_p: params.topP } : {}),
            ...(params.maxOutputTokens !== undefined ? { max_tokens: params.maxOutputTokens } : {}),
            ...(params.stop ? { stop: params.stop } : {}),
            ...(params.seed !== undefined ? { seed: params.seed } : {}),
            ...(params.reasoning && features.reasoning ? toWireReasoning(params.reasoning) : {}),
            stream: false,
          };
          const json = (await send(url, { method: 'POST', body: JSON.stringify(body) }, request.signal)) as WireResponse;
          try { return fromWireResponse(json); }
          catch (e) { throw new ModelError({ code: 'invalid_response', message: (e as Error).message, detail: json, cause: e }); }
        },
      };
    },
  };
}

async function backoff(attempt: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new ModelError({ code: 'aborted', message: 'aborted during backoff' });
  const ms = 500 * 2 ** attempt;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(new ModelError({ code: 'aborted', message: 'aborted during backoff' })); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
