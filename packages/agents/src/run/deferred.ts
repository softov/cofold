import type { KvScope } from '../types/store.js';
import type { ModelToolDefinition, Tool } from '../types/tool.js';
import type { TurnContext } from '../types/turn.js';
import { createTool } from '../tool/create-tool.js';

/** The core tool's name; no capability may contribute it. */
export const LOAD_TOOLS = 'load_tools';
/** Definitions one `query` returns at most. */
const QUERY_LIMIT = 10;
/** Characters of a description kept on an index line. */
const LINE_MAX = 120;

export const loadedKey = (sessionId: string): string => `loaded-tools/${sessionId}`;

const RULE = [
  'These tools exist but their definitions are not loaded.',
  `Call ${LOAD_TOOLS} with their names, or a query, to get the definitions before using one; do not guess their arguments.`,
].join(' ');

/** The definitions a request carries: every tool that is not deferred, then the deferred ones loaded this session, in tool order. */
export function requestToolsOf(ctx: Pick<TurnContext, 'tools' | 'loaded'>): ModelToolDefinition[] {
  return [...ctx.tools.values()].filter((tool) => tool.deferred !== true || ctx.loaded.has(tool.name)).map((tool) => tool.toModelDefinition());
}

/** The instructions of this step: the resolved ones plus the `## tools` index while something is deferred and unloaded. */
export function instructionsOf(ctx: Pick<TurnContext, 'tools' | 'loaded' | 'instructions'>): string {
  const unloaded = unloadedOf(ctx);
  if (unloaded.length === 0) return ctx.instructions;
  return `${ctx.instructions}\n\n## tools\n${RULE}\n\n${unloaded.map(indexLine).join('\n')}`;
}

export function unloadedOf(ctx: Pick<TurnContext, 'tools' | 'loaded'>): Tool<any, any>[] {
  return [...ctx.tools.values()].filter((tool) => tool.deferred === true && !ctx.loaded.has(tool.name));
}

/** Adds names to the session's loaded set and persists it; a name already there costs nothing. */
export async function markLoaded(args: { loaded: Set<string>; kv: KvScope; sessionId: string }, names: string[]): Promise<void> {
  const fresh = names.filter((name) => !args.loaded.has(name));
  if (fresh.length === 0) return;
  for (const name of fresh) args.loaded.add(name);
  await args.kv.set(loadedKey(args.sessionId), [...args.loaded]);
}

/** The session's loaded set from the store, keeping only names the run still has. */
export async function readLoaded(args: { tools: ReadonlyMap<string, Tool<any, any>>; kv: KvScope; sessionId: string }): Promise<Set<string>> {
  const stored = await args.kv.get<string[]>(loadedKey(args.sessionId));
  return new Set((Array.isArray(stored) ? stored : []).filter((name) => args.tools.get(name)?.deferred === true));
}

/**
 * The one core tool of AGENT-02 (decision 4): the index without arguments, the definitions for `names`
 * or for a `query`, loading what it returns for the rest of the session.
 */
export function createLoadToolsTool(ctx: Pick<TurnContext, 'tools' | 'loaded' | 'run' | 'sessionId'>): Tool<any, any> {
  const tool = createTool<{ names?: string[]; query?: string }>({
    name: LOAD_TOOLS,
    description: `Load the definitions of deferred tools so they can be called: by names, or by a query matched against names and descriptions (${QUERY_LIMIT} at most). Without arguments, list the deferred tools.`,
    input: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Tool names to load' },
        query: { type: 'string', description: 'Words to look for in names and descriptions' },
      },
      additionalProperties: false,
    },
    effects: {},
    execute: async (input) => {
      const deferred = [...ctx.tools.values()].filter((t) => t.deferred === true);
      if (input.names === undefined && input.query === undefined) {
        const unloaded = unloadedOf(ctx);
        const lines = unloaded.map(indexLine);
        const loaded = deferred.filter((t) => ctx.loaded.has(t.name)).map((t) => t.name);
        return [
          unloaded.length ? `Deferred tools, not loaded:\n${lines.join('\n')}` : 'Every deferred tool is loaded.',
          ...(loaded.length ? [`Loaded this session: ${loaded.join(', ')}`] : []),
        ].join('\n\n');
      }
      const chosen = new Map<string, Tool<any, any>>();
      const unknown: string[] = [];
      for (const name of input.names ?? []) {
        const hit = ctx.tools.get(name);
        if (hit === undefined) unknown.push(name);
        else chosen.set(name, hit);
      }
      if (input.query !== undefined) {
        const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
        for (const t of deferred) {
          if (chosen.size >= QUERY_LIMIT) break;
          const haystack = `${t.name} ${t.description}`.toLowerCase();
          if (words.length > 0 && words.every((word) => haystack.includes(word))) chosen.set(t.name, t);
        }
      }
      await markLoaded({ loaded: ctx.loaded, kv: ctx.run.kv.agent, sessionId: ctx.sessionId }, [...chosen.keys()].filter((name) => ctx.tools.get(name)?.deferred === true));
      const parts: string[] = [];
      if (chosen.size > 0) parts.push(`Loaded: ${[...chosen.keys()].join(', ')}\n\n${JSON.stringify([...chosen.values()].map((t) => t.toModelDefinition()), null, 2)}`);
      else if (input.query !== undefined) parts.push(`No deferred tool matches "${input.query}".`);
      if (unknown.length > 0) parts.push(`Unknown: ${unknown.join(', ')}`);
      return parts.join('\n\n');
    },
  });
  return Object.freeze({ ...tool, source: 'core' });
}

function indexLine(tool: Tool<any, any>): string {
  return `- ${tool.name}: ${firstSentence(tool.description)}`;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > LINE_MAX ? `${sentence.slice(0, LINE_MAX - 1)}…` : sentence;
}
