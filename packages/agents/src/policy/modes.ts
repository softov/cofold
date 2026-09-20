import type { Policy } from '../types/agent.js';
import type { PermissionMode, PermissionModeRules } from '../types/policy.js';
import { DEFAULT_DECIDE } from './rules.js';

/**
 * The harness's stricter default: a tool that writes, destroys or reaches the network asks.
 *
 * `DEFAULT_DECIDE` asks only about a destructive tool, which is what `auto` means; the modes
 * that mean "ask before changing anything" are this one, and a host that offers no mode gets
 * neither - it gets `DEFAULT_DECIDE` from `createAgent` unless it configures a policy.
 */
const askOnEffects: Policy['decide'] = ({ tool }) => {
  const { writes, destructive, network } = tool.effects;
  return { behavior: writes === true || destructive === true || network === true ? 'ask' : 'allow' };
};

/**
 * A permission mode as the decision a run takes when no rule matches (decision 117 keeps rules
 * ahead of it, so a deny or an ask rule still wins under `bypassPermissions`).
 *
 * `acceptEdits` is a check on where an edit goes rather than a rule, so the host says what an
 * edit is and where the workspace ends; `plan` refuses a change outright rather than asking,
 * which is what makes it a mode a model can work under without modifying anything.
 */
export function policyOf(mode: PermissionMode, rules: PermissionModeRules): Policy['decide'] {
  switch (mode) {
    case 'default': return askOnEffects;
    case 'acceptEdits': return (args) => {
      const path = (args.input as { path?: unknown } | undefined)?.path;
      if (rules.isEdit(args.tool) && typeof path === 'string' && rules.inside(path)) return { behavior: 'allow' };
      return askOnEffects(args);
    };
    case 'plan': return (args) => {
      const { writes, destructive } = args.tool.effects;
      if (writes === true || destructive === true) {
        return { behavior: 'deny', reason: `${args.tool.name} would change something and the mode is plan` };
      }
      return askOnEffects(args);
    };
    case 'auto': return DEFAULT_DECIDE;
    case 'bypassPermissions': return () => ({ behavior: 'allow' });
    case 'dontAsk': return async (args) => {
      const decision = await askOnEffects(args);
      return decision.behavior === 'ask'
        ? { behavior: 'deny', reason: `${args.tool.name} would need approval and the mode is dontAsk` }
        : decision;
    };
  }
}
