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

/** `GET /models`; the OpenAI shape plus OpenRouter's extra fields when present. */
export interface WireModelList {
  data?: WireModel[];
}

export interface WireModel {
  id: string;
  name?: string;
  context_length?: number;
  /** OpenRouter: USD per token as decimal strings. */
  pricing?: { prompt?: string; completion?: string };
  /** OpenRouter: request parameters the model accepts. */
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
}
