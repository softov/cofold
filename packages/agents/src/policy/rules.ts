import type { Policy } from '../types/agent.js';
import type { Rule, RulesOptions } from '../types/policy.js';
import type { Tool } from '../types/tool.js';

/** The default policy (cli/03 F3): ask when the tool is destructive, allow otherwise. `createAgent` and `rules()` share it. */
export const DEFAULT_DECIDE: Policy['decide'] = ({ tool }) => ({ behavior: tool.effects.destructive === true ? 'ask' : 'allow' });

/** `*` any run of characters, `?` one; anchored to the whole subject (decision 117). */
export function matchGlob(pattern: string, subject: string): boolean {
  const source = pattern
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`, 's').test(subject);
}

/**
 * A `Policy` from rule lists (decision 117): the first matching rule decides, `deny` before `ask` before `allow`;
 * a rule matches on the tool name (or `*`) and, when it has a `match`, on the glob over `tool.subject(input)`.
 * A rule with `match` never matches a tool without a `subject`. When nothing matches, `otherwise` decides.
 */
export function rules(options: RulesOptions): Policy {
  const otherwise = options.otherwise ?? DEFAULT_DECIDE;
  const first = (list: Rule[] | undefined, tool: Tool<any, any>, input: unknown): Rule | undefined =>
    list?.find((rule) =>
      (rule.tool === '*' || rule.tool === tool.name) &&
      (rule.match === undefined || (tool.subject !== undefined && matchGlob(rule.match, tool.subject(input)))));
  return {
    async decide(args) {
      const { tool, input } = args;
      const denied = first(options.deny, tool, input);
      if (denied) return { behavior: 'deny', reason: `Denied by rule: ${tool.name}${denied.match !== undefined ? `(${denied.match})` : ''}` };
      if (first(options.ask, tool, input)) return { behavior: 'ask' };
      if (first(options.allow, tool, input)) return { behavior: 'allow' };
      return otherwise(args);
    },
  };
}
