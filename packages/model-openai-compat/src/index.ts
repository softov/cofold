import { ModelError } from '@cofold/agents';
import type { ModelAdapter, ModelFeatures, ModelInfo, ModelProvider, ModelRequest, ModelStreamEvent } from '@cofold/agents';
import { fromWireModel, fromWireResponse, toWireMessages, toWireReasoning, toWireTools } from './wire.js';
import { parseSse } from './sse.js';
import { parseChunks, streamChunks } from './stream.js';
import type { OpenAICompatOptions, OpenAICompatProviderOptions } from './types/options.js';
import type { WireModelList, WireResponse } from './types/wire.js';

export type { OpenAICompatOptions, OpenAICompatProviderOptions } from './types/options.js';

/** Streaming is on by default (decision 104); a host turns it off per model with `features: { streaming: false }`. */
const DEFAULT_FEATURES: ModelFeatures = { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: false };

/** One-model shortcut over openaiCompatProvider(...).model(...). */
export function openaiCompat(options: OpenAICompatOptions): ModelAdapter {
  const { model, features, params, pricing, ...provider } = options;
  return openaiCompatProvider(provider).model({
    id: model,
    ...(features !== undefined ? { features } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
  });
}

export function openaiCompatProvider(options: OpenAICompatProviderOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const baseHeaders: Record<string, string> = { 'content-type': 'application/json', ...options.headers };

  /** Headers for one attempt: a key function is asked every time (decision 99). */
  async function headersFor(): Promise<Record<string, string>> {
    const key = typeof options.apiKey === 'function' ? await options.apiKey() : options.apiKey;
    return key ? { ...baseHeaders, authorization: `Bearer ${key}` } : baseHeaders;
  }

  /**
   * POST/GET with the retry policy of decision 32, up to a 2xx response: connection errors, 429 and 5xx are retried
   * before any body is read. What happens with the body is the caller's (`send` parses JSON, `sendStream` reads it
   * as it comes and retries nothing: no partial call may run twice).
   */
  async function attempt(url: string, init: { method: 'GET' | 'POST'; body?: string }, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      // Outside the try: a key function that throws is the host's error, not a network failure to retry.
      const headers = await headersFor();
      let res: Response;
      try {
        res = await doFetch(url, { ...init, headers, signal });
      } catch (e) {
        if (signal.aborted) {
          // A timeout signal (AbortSignal.timeout) is the server not answering, which is a network fact, not a cancellation.
          const timedOut = (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError';
          if (timedOut) throw new ModelError({ code: 'network', message: `cannot reach ${url}: no answer in time`, cause: e, retryable: true });
          throw new ModelError({ code: 'aborted', message: 'request aborted', cause: e });
        }
        if (attempt < retries) { await backoff(attempt, signal); continue; }
        // Node's fetch says "fetch failed" and keeps the reason on `cause`; the reason is what a person needs.
        const reason = (e as { cause?: { code?: string; message?: string } }).cause;
        throw new ModelError({ code: 'network', message: `cannot reach ${url}: ${reason?.code ?? reason?.message ?? (e as Error).message}`, cause: e, retryable: true });
      }
      if (res.ok) return res;
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

  /** The parsed JSON body of a 2xx. */
  async function send(url: string, init: { method: 'GET' | 'POST'; body?: string }, signal: AbortSignal): Promise<unknown> {
    const res = await attempt(url, init, signal);
    try { return await res.json(); }
    catch (e) { throw new ModelError({ code: 'invalid_response', message: 'response is not JSON', cause: e }); }
  }

  /** The body of a 2xx, to be read as it arrives. */
  async function sendStream(url: string, body: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const res = await attempt(url, { method: 'POST', body }, signal);
    if (!res.body) throw new ModelError({ code: 'invalid_response', message: 'response has no body to stream' });
    return res.body;
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

      /** The request body both forms share; the feature gates throw before anything is sent. */
      function bodyOf(request: ModelRequest): Record<string, unknown> {
        if (request.tools.length > 0 && !features.tools) {
          throw new ModelError({ code: 'unsupported_feature', message: `${args.id} does not support tools` });
        }
        let messages;
        try { messages = toWireMessages(request, features); }
        catch (e) { throw new ModelError({ code: 'unsupported_feature', message: (e as Error).message, cause: e }); }
        const params = { ...args.params, ...request.params };
        return {
          model: args.id,
          messages,
          ...(request.tools.length ? { tools: toWireTools(request), tool_choice: 'auto' } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(params.topP !== undefined ? { top_p: params.topP } : {}),
          ...(params.maxOutputTokens !== undefined ? { max_tokens: params.maxOutputTokens } : {}),
          ...(params.stop ? { stop: params.stop } : {}),
          ...(params.seed !== undefined ? { seed: params.seed } : {}),
          ...(params.reasoning && features.reasoning ? toWireReasoning(params.reasoning, options.reasoningBudgets) : {}),
          prompt_cache_key: request.cacheKey,
        };
      }

      return {
        id: `openai-compat:${args.id}`,
        modelId: args.id,
        features,
        ...(args.pricing !== undefined ? { pricing: args.pricing } : {}),
        async complete(request: ModelRequest) {
          const body = { ...bodyOf(request), stream: false };
          const json = (await send(url, { method: 'POST', body: JSON.stringify(body) }, request.signal)) as WireResponse;
          try { return fromWireResponse(json); }
          catch (e) { throw new ModelError({ code: 'invalid_response', message: (e as Error).message, detail: json, cause: e }); }
        },
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
          const body = { ...bodyOf(request), stream: true, stream_options: { include_usage: true } };
          const stream = await sendStream(url, JSON.stringify(body), request.signal);
          try {
            yield* streamChunks(parseChunks(parseSse(stream)));
          } catch (e) {
            if (e instanceof ModelError) throw e;
            if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'request aborted while streaming', cause: e });
            throw new ModelError({ code: 'network', message: `stream from ${url} broke: ${(e as Error).message}`, cause: e, retryable: false });
          }
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
