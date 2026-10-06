import type { Policy } from '../types/agent.js';
import type { PermissionMode, PermissionModeRules } from '../types/policy.js';
import type { Tool } from '../types/tool.js';
import { DEFAULT_DECIDE } from './rules.js';

/** The host's answer when it gives none: a tool that names the file it writes is an edit (decision CLI-04.6). */
const declaresWrites = (tool: Tool<any, any>): boolean => tool.writes !== undefined;

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

/**
 * The file a call writes: the tool's own `writes`, or the `path` its input names for a tool that declares none.
 *
 * A `writes` that throws names no file, and then there is no fallback: the call is judged as a non-edit and asks,
 * rather than failing the run on a host tool's error.
 */
function writesOf(tool: Tool<any, any>, input: unknown): unknown {
  if (tool.writes === undefined) return (input as { path?: unknown } | undefined)?.path;
  try {
    return tool.writes(input);
  } catch {
    return undefined;
  }
}

/** The path a read names: its `path`, or its `cwd` when it has no `path`. */
function readTarget(input: unknown): string | undefined {
  const { path, cwd } = (input ?? {}) as { path?: unknown; cwd?: unknown };
  if (typeof path === 'string') return path;
  return typeof cwd === 'string' ? cwd : undefined;
}

/**
 * The modes a host may offer, in the harness's order.
 *
 * The union is the vocabulary; this is the list a host draws its own choices from, so two hosts
 * that offer a mode offer the same words for it. A host that offers fewer takes the ones it wants
 * and keeps this order, and the label a person reads stays the host's.
 */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const satisfies readonly PermissionMode[];

/** One plain sentence per mode, saying what `policyOf` does with it; it is library text a host may show as it is. */
export const PERMISSION_MODE_DESCRIPTIONS: Readonly<Record<PermissionMode, string>> = {
  default: 'Asks before writing, going online or destroying anything.',
  acceptEdits: 'Writes inside the working directory without asking, and asks for other tools.',
  plan: 'Reads only: anything that writes or destroys is refused.',
  auto: 'Asks only when a tool says it is destructive.',
  bypassPermissions: 'Runs every tool without asking.',
  dontAsk: 'Refuses anything that would have needed approval, without asking.',
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
  const onEffects = askOnEffects(rules);
  switch (mode) {
    case 'default': return onEffects;
    case 'acceptEdits': return (args) => {
      // The tool's own `writes` first, so a call is judged by the file it really touches; `input.path` is what a
      // tool that declares neither leaves for the host to read. A `writes` that throws names no file either, and
      // then the call is a non-edit: it asks rather than failing the run.
      const path = writesOf(args.tool, args.input);
      const isEdit = rules.isEdit ?? declaresWrites;
      if (isEdit(args.tool) && typeof path === 'string' && rules.inside(path)) return { behavior: 'allow' };
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
