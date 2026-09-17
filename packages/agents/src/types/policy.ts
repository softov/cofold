import type { Policy } from './agent.js';

/** One permission rule (decision 117): a tool name or `*`, and an optional glob over the tool's subject. */
export interface Rule {
  tool: string;
  match?: string;
}

/** What `rules()` takes: the lists are evaluated `deny`, then `ask`, then `allow` (decision 117). */
export interface RulesOptions {
  deny?: Rule[];
  ask?: Rule[];
  allow?: Rule[];
  /** Decides when no rule matches; default: ask when destructive, allow otherwise (agent/04 task 01). */
  otherwise?: Policy['decide'];
}
