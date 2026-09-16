import type { WireModelList, WireResponse } from './types/wire.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelError, textOf, toolCallsOf } from '@facio/agents';
import type { Message, ModelRequest } from '@facio/agents';
import { openaiCompat, openaiCompatProvider } from './index.js';

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function stubFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const next = responses.shift();
    if (!next) throw new Error('no stubbed response left');
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetch: fetchStub as unknown as typeof fetch };
}

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status: number) => new Response(body, { status });

const user = (t: string): Message => ({ id: 'u1', role: 'user', source: 'input', createdAt: 'now', parts: [{ type: 'text', text: t }] });

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    instructions: 'be brief',
    messages: [user('hi')],
    tools: [{ name: 'now', description: 'time', input: { type: 'object', properties: {} } }],
    params: {},
    cacheKey: 'session-1',
    signal: new AbortController().signal,
    ...overrides,
  };
}

const okText: WireResponse = {
  choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } },
};

async function codeOf(p: Promise<unknown>): Promise<ModelError> {
  try {
    await p;
    throw new Error('expected a ModelError');
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    return e as ModelError;
  }
}

describe('openaiCompat request mapping', () => {
  it('sends system first, user text as a string, assistant tool_calls with raw arguments, tool results with tool_call_id', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://localhost:1234/v1/', model: 'm', apiKey: 'k', headers: { 'x-extra': '1' }, params: { temperature: 0.5 }, fetch });
    expect(model.id).toBe('openai-compat:m');
    expect(model.modelId).toBe('m');
    expect(model.features).toEqual({ tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false });

    const assistant: Message = {
      id: 'a1', role: 'assistant', source: 'model', createdAt: 'now',
      parts: [{ type: 'text', text: 'let me check' }, { type: 'toolCall', callId: 'call_1', name: 'now', input: {}, raw: '{}' }],
    };
    const toolMsg: Message = { id: 't1', role: 'tool', source: 'tool', createdAt: 'now', parts: [{ type: 'toolResult', callId: 'call_1', name: 'now', content: '12:00', isError: false }] };
    await model.complete(request({ messages: [user('hi'), assistant, toolMsg], params: { maxOutputTokens: 5, seed: 1 } }));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ 'content-type': 'application/json', 'x-extra': '1', authorization: 'Bearer k' });
    expect(call.body).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'let me check', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'now', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', name: 'now', content: '12:00' },
      ],
      tools: [{ type: 'function', function: { name: 'now', description: 'time', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'auto',
      temperature: 0.5,
      max_tokens: 5,
      seed: 1,
      prompt_cache_key: 'session-1',
      stream: false,
    });
  });

  it('sends the request cacheKey as prompt_cache_key (decision 100)', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request({ cacheKey: 'other-session' }));
    expect(calls[0]!.body.prompt_cache_key).toBe('other-session');
  });

  it('omits tools and tool_choice when the request has no tools, and sends no authorization without a key', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    await model.complete(request({ tools: [] }));
    expect(calls[0]!.body).not.toHaveProperty('tools');
    expect(calls[0]!.body).not.toHaveProperty('tool_choice');
    expect(calls[0]!.init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('sends an assistant message with tool calls and no text as content null', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    const assistant: Message = { id: 'a1', role: 'assistant', source: 'model', createdAt: 'now', parts: [{ type: 'toolCall', callId: 'c', name: 'now', input: {}, raw: '{}' }] };
    await model.complete(request({ messages: [assistant] }));
    expect((calls[0]!.body.messages as unknown[])[1]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'now', arguments: '{}' } }] });
  });

  it('sends image parts as image_url when the model supports images', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', features: { images: true }, fetch });
    const withImage: Message = { id: 'u', role: 'user', source: 'input', createdAt: 'now', parts: [{ type: 'text', text: 'see' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] };
    await model.complete(request({ messages: [withImage] }));
    expect((calls[0]!.body.messages as unknown[])[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    });
  });
});

describe('openaiCompat reasoning', () => {
  it('sends reasoning_effort for effort only, and the reasoning object when a budget is set', async () => {
    const { calls, fetch } = stubFetch([json(okText), json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', features: { reasoning: true }, fetch });
    await model.complete(request({ params: { reasoning: { effort: 'high' } } }));
    expect(calls[0]!.body).toMatchObject({ reasoning_effort: 'high' });
    expect(calls[0]!.body).not.toHaveProperty('reasoning');
    await model.complete(request({ params: { reasoning: { effort: 'low', maxTokens: 512 } } }));
    expect(calls[1]!.body).toMatchObject({ reasoning: { effort: 'low', max_tokens: 512 } });
    expect(calls[1]!.body).not.toHaveProperty('reasoning_effort');
  });

  it('sends every effort level as-is, including the ones outside low/medium/high (decision 98)', async () => {
    const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
    const { calls, fetch } = stubFetch(levels.map(() => json(okText)));
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', features: { reasoning: true }, fetch });
    for (const effort of levels) await model.complete(request({ params: { reasoning: { effort } } }));
    expect(calls.map((c) => c.body.reasoning_effort)).toEqual([...levels]);
  });

  it('turns an effort into max_tokens when the provider has a budget for it, and leaves the others as a level', async () => {
    const { calls, fetch } = stubFetch([json(okText), json(okText), json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', features: { reasoning: true }, reasoningBudgets: { xhigh: 32_000 }, fetch });
    await model.complete(request({ params: { reasoning: { effort: 'xhigh' } } }));
    expect(calls[0]!.body).toMatchObject({ reasoning: { max_tokens: 32_000 } });
    expect(calls[0]!.body).not.toHaveProperty('reasoning_effort');
    await model.complete(request({ params: { reasoning: { effort: 'low' } } }));
    expect(calls[1]!.body).toMatchObject({ reasoning_effort: 'low' });
    expect(calls[1]!.body).not.toHaveProperty('reasoning');
    // An explicit maxTokens wins over the budget map.
    await model.complete(request({ params: { reasoning: { effort: 'xhigh', maxTokens: 100 } } }));
    expect(calls[2]!.body).toMatchObject({ reasoning: { effort: 'xhigh', max_tokens: 100 } });
  });

  it('sends nothing for reasoning when the model does not support it', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request({ params: { reasoning: { effort: 'high' } } }));
    expect(calls[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(calls[0]!.body).not.toHaveProperty('reasoning');
  });

  it('never sends reasoning parts back to the model', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const assistant: Message = { id: 'a', role: 'assistant', source: 'model', createdAt: 'now', parts: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'ok' }] };
    await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request({ messages: [assistant] }));
    expect((calls[0]!.body.messages as unknown[])[1]).toEqual({ role: 'assistant', content: 'ok' });
  });

  it('maps message.reasoning (OpenRouter) and reasoning_content (DeepSeek) to a reasoning part first', async () => {
    const mk = (message: Record<string, unknown>) => json({ choices: [{ message, finish_reason: 'stop' }] });
    const { fetch } = stubFetch([mk({ role: 'assistant', content: 'answer', reasoning: 'because' }), mk({ role: 'assistant', content: 'answer', reasoning_content: 'since' })]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    expect((await model.complete(request())).message.parts).toEqual([{ type: 'reasoning', text: 'because' }, { type: 'text', text: 'answer' }]);
    expect((await model.complete(request())).message.parts).toEqual([{ type: 'reasoning', text: 'since' }, { type: 'text', text: 'answer' }]);
  });

  it('moves a leading <think> block out of content into a reasoning part', async () => {
    const { fetch } = stubFetch([json({ choices: [{ message: { role: 'assistant', content: '<think>\nlet me see\n</think>\n\nfinal' }, finish_reason: 'stop' }] })]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    expect(reply.message.parts).toEqual([{ type: 'reasoning', text: '\nlet me see\n' }, { type: 'text', text: 'final' }]);
    expect(textOf(reply.message)).toBe('final');
  });

  it('maps reasoning tokens from completion_tokens_details', async () => {
    const body: WireResponse = { choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 7 } } };
    const { fetch } = stubFetch([json(body)]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    expect(reply.usage).toEqual({ inputTokens: 1, outputTokens: 9, reasoningTokens: 7 });
  });
});

describe('openaiCompatProvider', () => {
  const list: WireModelList = {
    data: [
      { id: 'local/plain' },
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o mini',
        context_length: 128000,
        pricing: { prompt: '0.00000015', completion: '0.0000006' },
        supported_parameters: ['tools', 'response_format', 'reasoning'],
        architecture: { input_modalities: ['text', 'image'] },
        top_provider: { max_completion_tokens: 16384 },
      },
      { id: 'x/no-tools', supported_parameters: ['temperature'], pricing: { prompt: 'n/a' }, top_provider: { max_completion_tokens: null } },
    ],
  };

  it('derives its id from the name or the URL host', () => {
    expect(openaiCompatProvider({ baseUrl: 'http://localhost:1234/v1' }).id).toBe('openai-compat:localhost:1234');
    expect(openaiCompatProvider({ baseUrl: 'https://openrouter.ai/api/v1', name: 'openrouter' }).id).toBe('openai-compat:openrouter');
  });

  it('lists models from GET /models with best-effort features, limits and pricing', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const getStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(list);
    }) as unknown as typeof fetch;
    const provider = openaiCompatProvider({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'k', fetch: getStub });
    const models = await provider.listModels();
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/models');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer k' });
    expect(models).toEqual([
      { id: 'local/plain', name: 'local/plain', features: { tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false } },
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o mini',
        features: { tools: true, streaming: false, images: true, structuredOutput: true, reasoning: true },
        contextTokens: 128000,
        maxOutputTokens: 16384,
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: 'USD' },
      },
      { id: 'x/no-tools', name: 'x/no-tools', features: { tools: false, streaming: false, images: false, structuredOutput: false, reasoning: false } },
    ]);
  });

  it('throws invalid_response when the list has no data[]', async () => {
    const { fetch } = stubFetch([json({ object: 'list' })]);
    const e = await codeOf(openaiCompatProvider({ baseUrl: 'http://x', fetch }).listModels());
    expect(e.code).toBe('invalid_response');
  });

  it('builds adapters that share the endpoint, key and defaults', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const provider = openaiCompatProvider({ baseUrl: 'http://x', apiKey: 'k', fetch });
    const model = provider.model({ id: 'm', features: { tools: false }, params: { temperature: 0.1 } });
    expect(model.id).toBe('openai-compat:m');
    expect(model.features.tools).toBe(false);
    await model.complete(request({ tools: [] }));
    expect(calls[0]!.url).toBe('http://x/chat/completions');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer k' });
    expect(calls[0]!.body).toMatchObject({ model: 'm', temperature: 0.1 });
  });
});

describe('openaiCompat response mapping', () => {
  it('maps text, usage and cached tokens', async () => {
    const { fetch } = stubFetch([json(okText)]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    expect(reply.finish).toBe('stop');
    expect(reply.message.role).toBe('assistant');
    expect(reply.message.source).toBe('model');
    expect(textOf(reply.message)).toBe('hello');
    expect(reply.usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 });
    expect(reply.raw).toEqual(okText);
  });

  it('maps tool_calls to toolCall parts with finish tool_calls', async () => {
    const body: WireResponse = {
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'now', arguments: '{"tz":"utc"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    };
    const { fetch } = stubFetch([json(body)]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    expect(reply.finish).toBe('tool_calls');
    expect(reply.message.parts).toEqual([{ type: 'toolCall', callId: 'call_9', name: 'now', input: { tz: 'utc' }, raw: '{"tz":"utc"}' }]);
    expect(reply.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('keeps raw and sets input undefined when arguments are not JSON, without throwing', async () => {
    const body: WireResponse = {
      choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: '', type: 'function', function: { name: 'now', arguments: '{not json' } }] }, finish_reason: 'stop' }],
    };
    const { fetch } = stubFetch([json(body)]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    const [call] = toolCallsOf(reply.message);
    expect(call).toMatchObject({ name: 'now', input: undefined, raw: '{not json' });
    expect(call!.callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply.finish).toBe('tool_calls');
    expect(reply.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('joins array-shaped content text parts', async () => {
    const body = { choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'hel' }, { type: 'image_url', image_url: { url: 'x' } }, { type: 'text', text: 'lo' }] }, finish_reason: 'stop' }] };
    const { fetch } = stubFetch([json(body)]);
    const reply = await openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request());
    expect(reply.message.parts).toEqual([{ type: 'text', text: 'hello' }]);
    expect(reply.finish).toBe('stop');
  });

  it('maps length and content_filter, and unknown reasons to other', async () => {
    const mk = (finish_reason: string) => json({ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason }] });
    const { fetch } = stubFetch([mk('length'), mk('content_filter'), mk('weird')]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    expect((await model.complete(request())).finish).toBe('length');
    expect((await model.complete(request())).finish).toBe('content_filter');
    expect((await model.complete(request())).finish).toBe('other');
  });

  it('throws invalid_response when the body has no choices or is not JSON', async () => {
    const { fetch } = stubFetch([json({ choices: [] }), text('<html>', 200)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    const e1 = await codeOf(model.complete(request()));
    expect(e1.code).toBe('invalid_response');
    expect(e1.message).toBe('response has no choices[0].message');
    expect(e1.detail).toEqual({ choices: [] });
    const e2 = await codeOf(model.complete(request()));
    expect(e2.code).toBe('invalid_response');
    expect(e2.message).toBe('response is not JSON');
  });
});

describe('openaiCompat errors and retries', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function settle<T>(p: Promise<T>): Promise<T> {
    // Retries wait on setTimeout; drain every pending timer while the promise is in flight.
    const guarded = p.catch((e: unknown) => ({ __err: e }));
    await vi.runAllTimersAsync();
    const r = await guarded;
    if (r !== null && typeof r === 'object' && '__err' in r) throw r.__err;
    return r as T;
  }

  it('retries 429 then succeeds with two fetch calls', async () => {
    const { calls, fetch } = stubFetch([text('slow down', 429), json(okText)]);
    const reply = await settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request()));
    expect(textOf(reply.message)).toBe('hello');
    expect(calls).toHaveLength(2);
  });

  it('does not retry 401 and throws auth after one call', async () => {
    const { calls, fetch } = stubFetch([text('nope', 401)]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request())));
    expect(e.code).toBe('auth');
    expect(e.status).toBe(401);
    expect(e.retryable).toBe(false);
    expect(e.message).toBe('401 from http://x/chat/completions: nope');
    expect(calls).toHaveLength(1);
  });

  it('does not retry other 4xx and throws invalid_response', async () => {
    const { calls, fetch } = stubFetch([text('bad', 400)]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request())));
    expect(e.code).toBe('invalid_response');
    expect(e.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('retries 5xx up to retries and then throws server after three calls', async () => {
    const { calls, fetch } = stubFetch([text('a', 500), text('b', 502), text('c', 503)]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request())));
    expect(e.code).toBe('server');
    expect(e.status).toBe(503);
    expect(e.retryable).toBe(true);
    expect(e.detail).toBe('c');
    expect(calls).toHaveLength(3);
  });

  it('honors a custom retries count for 429', async () => {
    const { calls, fetch } = stubFetch([text('a', 429)]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', retries: 0, fetch }).complete(request())));
    expect(e.code).toBe('rate_limit');
    expect(calls).toHaveLength(1);
  });

  it('retries a network failure and then throws network', async () => {
    const { calls, fetch } = stubFetch([new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), json(okText)]);
    const reply = await settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request()));
    expect(textOf(reply.message)).toBe('hello');
    expect(calls).toHaveLength(3);

    const failing = stubFetch([new Error('x'), new Error('y'), new Error('z')]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch: failing.fetch }).complete(request())));
    expect(e.code).toBe('network');
    expect(e.retryable).toBe(true);
    expect(failing.calls).toHaveLength(3);
  });

  it('asks an apiKey function once per attempt: one call for a 401, two for a 500 then 200 (decision 99)', async () => {
    let n = 0;
    const apiKey = vi.fn(async () => `token-${++n}`);
    const denied = stubFetch([text('nope', 401)]);
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', apiKey, fetch: denied.fetch }).complete(request())));
    expect(e.code).toBe('auth');
    expect(apiKey).toHaveBeenCalledTimes(1);
    expect(denied.calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer token-1' });

    const flaky = stubFetch([text('a', 500), json(okText)]);
    await settle(openaiCompat({ baseUrl: 'http://x', model: 'm', apiKey, fetch: flaky.fetch }).complete(request()));
    expect(apiKey).toHaveBeenCalledTimes(3);
    expect(flaky.calls.map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual(['Bearer token-2', 'Bearer token-3']);
  });

  it('throws aborted when the signal is aborted during the request', async () => {
    const controller = new AbortController();
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort();
      throw (init?.signal as AbortSignal).reason;
    }) as unknown as typeof fetch;
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch: doFetch }).complete(request({ signal: controller.signal }))));
    expect(e.code).toBe('aborted');
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('throws network, not aborted, when a timeout signal ends the request', async () => {
    // What AbortSignal.timeout() leaves on the signal, without waiting for it.
    const controller = new AbortController();
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      throw (init?.signal as AbortSignal).reason;
    }) as unknown as typeof fetch;
    const e = await codeOf(settle(openaiCompat({ baseUrl: 'http://x', model: 'm', fetch: doFetch }).complete(request({ signal: controller.signal }))));
    expect(e.code).toBe('network');
    expect(e.message).toBe('cannot reach http://x/chat/completions: no answer in time');
  });

  it('throws aborted when the signal fires during backoff', async () => {
    const controller = new AbortController();
    const { calls, fetch } = stubFetch([text('slow', 429), json(okText)]);
    const p = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch }).complete(request({ signal: controller.signal }));
    const guarded = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const e = await guarded;
    expect(e).toBeInstanceOf(ModelError);
    expect((e as ModelError).code).toBe('aborted');
    expect(calls).toHaveLength(1);
  });
});

describe('openaiCompat feature gates', () => {
  it('throws unsupported_feature for an image part when images are off, before any fetch', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', fetch });
    const withImage: Message = { id: 'u', role: 'user', source: 'input', createdAt: 'now', parts: [{ type: 'image', mimeType: 'image/png', url: 'http://img' }] };
    const e = await codeOf(model.complete(request({ messages: [withImage] })));
    expect(e.code).toBe('unsupported_feature');
    expect(calls).toHaveLength(0);
  });

  it('throws unsupported_feature when tools are requested but not supported, before any fetch', async () => {
    const { calls, fetch } = stubFetch([json(okText)]);
    const model = openaiCompat({ baseUrl: 'http://x', model: 'm', features: { tools: false }, fetch });
    const e = await codeOf(model.complete(request()));
    expect(e.code).toBe('unsupported_feature');
    expect(e.message).toBe('m does not support tools');
    expect(calls).toHaveLength(0);
    await model.complete(request({ tools: [] }));
    expect(calls).toHaveLength(1);
  });
});
