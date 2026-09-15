import { ModelError } from '@facio/agents';
import type { ModelAdapter, ModelFeatures, ModelParams, ModelRequest } from '@facio/agents';
import { fromWireResponse, toWireMessages, toWireTools } from './wire.js';
import type { WireResponse } from './wire.js';

export interface OpenAICompatOptions {
  /** e.g. 'http://localhost:1234/v1' or 'https://openrouter.ai/api/v1' */
  baseUrl: string;
  /** Provider model id. */
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  features?: Partial<ModelFeatures>;
  params?: ModelParams;
  /** Retries on 429 and 5xx; default 2. */
  retries?: number;
  /** Injection for tests. */
  fetch?: typeof fetch;
}

export function openaiCompat(options: OpenAICompatOptions): ModelAdapter {
  const features: ModelFeatures = { tools: true, streaming: false, images: false, structuredOutput: false, ...options.features };
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    id: `openai-compat:${options.model}`,
    modelId: options.model,
    features,
    async complete(request: ModelRequest) {
      if (request.tools.length > 0 && !features.tools) {
        throw new ModelError({ code: 'unsupported_feature', message: `${options.model} does not support tools` });
      }
      let messages;
      try { messages = toWireMessages(request, features); }
      catch (e) { throw new ModelError({ code: 'unsupported_feature', message: (e as Error).message, cause: e }); }
      const params = { ...options.params, ...request.params };
      const body = {
        model: options.model,
        messages,
        ...(request.tools.length ? { tools: toWireTools(request), tool_choice: 'auto' } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.topP !== undefined ? { top_p: params.topP } : {}),
        ...(params.maxOutputTokens !== undefined ? { max_tokens: params.maxOutputTokens } : {}),
        ...(params.stop ? { stop: params.stop } : {}),
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
        stream: false,
      };
      const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal });
        } catch (e) {
          if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'request aborted', cause: e });
          if (attempt < retries) { await backoff(attempt, request.signal); continue; }
          throw new ModelError({ code: 'network', message: `fetch failed: ${(e as Error).message}`, cause: e, retryable: true });
        }
        if (res.ok) {
          let json: WireResponse;
          try { json = (await res.json()) as WireResponse; }
          catch (e) { throw new ModelError({ code: 'invalid_response', message: 'response is not JSON', cause: e }); }
          try { return fromWireResponse(json); }
          catch (e) { throw new ModelError({ code: 'invalid_response', message: (e as Error).message, detail: json, cause: e }); }
        }
        const text = await res.text().catch(() => '');
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < retries) { await backoff(attempt, request.signal); continue; }
        throw new ModelError({
          code: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'invalid_response',
          message: `${res.status} from ${url}: ${text.slice(0, 500)}`,
          status: res.status,
          retryable,
          detail: text,
        });
      }
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
