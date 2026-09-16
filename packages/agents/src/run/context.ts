import type { Message } from '../types/message.js';
import type { ModelParams, ModelRequest } from '../types/model.js';
import type { ModelToolDefinition } from '../types/tool.js';

export function estimateMessageTokens(message: Message, estimate: (text: string) => number): number {
  let n = 4; // role and framing
  for (const p of message.parts) {
    switch (p.type) {
      case 'text': n += estimate(p.text); break;
      case 'toolCall': n += estimate(p.name) + estimate(p.raw); break;
      case 'toolResult': n += estimate(p.content); break;
      case 'image': n += 1_000; break;   // flat cost until a provider reports one
      case 'reasoning': break;           // never sent (decision 60)
    }
  }
  return n;
}

/** Splits history into units: an assistant message with tool calls plus the tool messages answering it; anything else alone. */
export function groupUnits(history: Message[]): Message[][] {
  const units: Message[][] = [];
  for (const m of history) {
    const last = units.at(-1);
    const lastHead = last?.[0];
    const answersLast =
      m.role === 'tool' && lastHead?.role === 'assistant' && lastHead.parts.some((p) => p.type === 'toolCall');
    if (answersLast && last) last.push(m);
    else units.push([m]);
  }
  return units;
}

/** The ids every summary in the history stands for. */
export function summarizedIds(history: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of history) for (const id of message.summarizes ?? []) ids.add(id);
  return ids;
}

/**
 * What a request is assembled from (AGENT-01-p5 Task 6): the newest summary first, then every message
 * no summary stands for, in transcript order. An auto-compacted turn's own input is such a message:
 * it sits before the summary on disk and after it in the request. The originals stay in the store.
 */
export function contextOf(history: Message[]): Message[] {
  const at = history.findLastIndex((message) => message.source === 'summary');
  if (at === -1) return history;
  const covered = summarizedIds(history);
  return [history[at]!, ...history.filter((message) => message.source !== 'summary' && !covered.has(message.id))];
}

/** The `recent` strategy (decision 60): newest units first while they fit; the newest unit always goes in. */
export function assembleRequest(args: {
  instructions: string;
  history: Message[];
  tools: ModelToolDefinition[];
  params: ModelParams;
  /** The session id: a session's prefix is stable, so a provider-side prompt cache is keyed by it (decision 100). */
  cacheKey: string;
  maxTokens: number;
  estimateTokens: (text: string) => number;
  signal: AbortSignal;
}): ModelRequest {
  const budget = args.maxTokens - args.estimateTokens(args.instructions);
  const units = groupUnits(contextOf(args.history));
  const picked: Message[][] = [];
  let used = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i]!;
    const cost = unit.reduce((n, m) => n + estimateMessageTokens(m, args.estimateTokens), 0);
    if (picked.length > 0 && used + cost > budget) break;
    picked.unshift(unit);
    used += cost;
  }
  const messages = picked.flat().map(stripReasoning);
  return { instructions: args.instructions, messages, tools: args.tools, params: args.params, cacheKey: args.cacheKey, signal: args.signal };
}

function stripReasoning(m: Message): Message {
  return m.parts.some((p) => p.type === 'reasoning') ? { ...m, parts: m.parts.filter((p) => p.type !== 'reasoning') } : m;
}
