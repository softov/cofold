import type { McpCallResult } from './types.js';

/**
 * A `tools/call` result as the text the model reads: each text part, a resource's text, a resource link's URI,
 * `[image]` or `[audio]` for media, and `structuredContent` as JSON when no part carries text.
 */
export function outputOf(result: McpCallResult): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    switch (part.type) {
      case 'text': parts.push(String((part as { text: unknown }).text)); break;
      case 'image': case 'audio': parts.push(`[${part.type}]`); break;
      case 'resource_link': parts.push(String((part as { uri: unknown }).uri)); break;
      case 'resource': {
        const resource = (part as { resource?: { uri?: string; text?: string } }).resource;
        parts.push(resource?.text ?? resource?.uri ?? '[resource]');
        break;
      }
      default: break;
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n');
}
