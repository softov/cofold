import type { Message, TextPart, ToolCallPart } from '../types/message.js';

export function textOf(message: Message): string {
  return message.parts.filter((p): p is TextPart => p.type === 'text').map((p) => p.text).join('');
}
export function toolCallsOf(message: Message): ToolCallPart[] {
  return message.parts.filter((p): p is ToolCallPart => p.type === 'toolCall');
}
