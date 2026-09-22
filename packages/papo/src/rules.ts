import type { Rule } from '@doopx/agents';
import { AgentError } from '@doopx/agents';
import type { RuleLists } from './types/config.js';

/** `Tool` or `Tool(match)`: a tool name (or `*`) with, in parentheses, the glob over its subject; spaces inside the parentheses are the match's. */
const RULE = /^([^\s()]+)(?:\((.*)\))?$/s;

/**
 * A rule as the shell spells it (decision CLI-04.5): `shell_exec(rm *)`, `write_file(src/*)`, `web_fetch`.
 * AgentError('invalid_options') when the text is not one.
 */
export function parseRule(text: string): Rule {
  const found = RULE.exec(text.trim());
  if (found === null) throw new AgentError({ code: 'invalid_options', message: `rule "${text}" must be written Tool or Tool(match)` });
  const [, tool, match] = found;
  if (match === '') throw new AgentError({ code: 'invalid_options', message: `rule "${text}" has an empty match; write the glob or drop the parentheses` });
  return { tool: tool!, ...(match !== undefined ? { match } : {}) };
}

/** A rule as the shell prints it: the inverse of `parseRule`. */
export function formatRule(rule: Rule): string {
  return rule.match === undefined ? rule.tool : `${rule.tool}(${rule.match})`;
}

/** Every rule of every list is `{ tool, match? }` with a tool name; what a settings patch is checked with. */
export function checkRules(lists: RuleLists): void {
  for (const name of ['deny', 'ask', 'allow'] as const) {
    for (const rule of lists[name] ?? []) {
      if (typeof rule.tool !== 'string' || rule.tool === '') throw new AgentError({ code: 'invalid_options', message: `rules.${name}: every rule names a tool` });
      if (rule.match !== undefined && (typeof rule.match !== 'string' || rule.match === '')) throw new AgentError({ code: 'invalid_options', message: `rules.${name}: a match is a non-empty glob` });
    }
  }
}
