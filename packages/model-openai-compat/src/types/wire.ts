export type WireTextPart = { type: 'text'; text: string };
export type WireImagePart = { type: 'image_url'; image_url: { url: string } };

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | (WireTextPart | WireImagePart)[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
  /** OpenRouter. */
  reasoning?: string | null;
  /** DeepSeek, LM Studio and vLLM style. */
  reasoning_content?: string | null;
}

export interface WireResponse {
  choices?: { message?: WireMessage; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** One `data:` payload of a streamed completion (`stream: true`); `usage` arrives on the last one with `stream_options.include_usage`. */
export interface WireChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: WireResponse['usage'];
}

/** `GET /models`; the OpenAI shape plus OpenRouter's extra fields when present. */
export interface WireModelList {
  data?: WireModel[];
}

export interface WireModel {
  id: string;
  name?: string;
  context_length?: number;
  /** OpenRouter: USD per token as decimal strings (verified against `GET /models`, 2026-09-16). */
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
  /** OpenRouter: request parameters the model accepts. */
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
}
