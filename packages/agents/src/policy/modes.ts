import type { Policy } from '../types/agent.js';
import type { PermissionMode, PermissionModeRules } from '../types/policy.js';
import { DEFAULT_DECIDE } from './rules.js';

/**
 * The harness's stricter default: a tool that writes, destroys or reaches the network asks, and
 * so does a read that names a path outside the workspace.
 *
 * A read names its target by `path`, or by `cwd` when it has no `path`; a read that names neither
 * works in the workspace and is allowed.
 *
 * `DEFAULT_DECIDE` asks only about a destructive tool, which is what `auto` means; the modes
 * that mean "ask before changing anything" are this one, and a host that offers no mode gets
 * neither - it gets `DEFAULT_DECIDE` from `createAgent` unless it configures a policy.
 */
const askOnEffects = (rules: PermissionModeRules): Policy['decide'] => ({ tool, input }) => {
  const { reads, writes, destructive, network } = tool.effects;
  if (writes === true || destructive === true || network === true) return { behavior: 'ask' };
  if (reads === true) {
    const target = readTarget(input);
    if (target !== undefined && !rules.inside(target)) return { behavior: 'ask' };
  }
  return { behavior: 'allow' };
};

/** The path a read names: its `path`, or its `cwd` when it has no `path`. */
function readTarget(input: unknown): string | undefined {
  const { path, cwd } = (input ?? {}) as { path?: unknown; cwd?: unknown };
  if (typeof path === 'string') return path;
  return typeof cwd === 'string' ? cwd : undefined;
}

/**
 * A permission mode as the decision a run takes when no rule matches (decision 117 keeps rules
 * ahead of it, so a deny or an ask rule still wins under `bypassPermissions`).
 *
 * `acceptEdits` is a check on where an edit goes rather than a rule, so the host says what an
 * edit is and where the workspace ends; `plan` refuses a change outright rather than asking,
 * which is what makes it a mode a model can work under without modifying anything.
 */
export function policyOf(mode: PermissionMode, rules: PermissionModeRules): Policy['decide'] {
  const onEffects = askOnEffects(rules);
  switch (mode) {
    case 'default': return onEffects;
    case 'acceptEdits': return (args) => {
      const path = (args.input as { path?: unknown } | undefined)?.path;
      if (rules.isEdit(args.tool) && typeof path === 'string' && rules.inside(path)) return { behavior: 'allow' };
      return onEffects(args);
    };
    case 'plan': return (args) => {
      const { writes, destructive } = args.tool.effects;
      if (writes === true || destructive === true) {
        return { behavior: 'deny', reason: `${args.tool.name} would change something and the mode is plan` };
      }
      return onEffects(args);
    };
    case 'auto': return DEFAULT_DECIDE;
    case 'bypassPermissions': return () => ({ behavior: 'allow' });
    case 'dontAsk': return async (args) => {
      const decision = await onEffects(args);
      return decision.behavior === 'ask'
        ? { behavior: 'deny', reason: `${args.tool.name} would need approval and the mode is dontAsk` }
        : decision;
    };
  }
}
