---
title: rules() builds a Policy from allow, ask and deny lists; a tool names its subject
status: done
depends: [task-01-decide-and-precedence.md]
layer: agents
refs:
  - code://packages/agents/src/types/tool.ts#L31-L53 - `ToolDefinition` / `Tool`, where `subject` goes
  - code://packages/agents/src/tool/create-tool.ts#L20-L27 - `createTool` spreads the definition onto the frozen tool; `subject` needs no copy
  - code://packages/agents/src/index.ts - exports; `rules` is added
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2310-L2403 - Claude's rule shape this mirrors
---

## Objective

`rules({ allow, deny, ask, otherwise })` is a `Policy` the harness evaluates; a tool's `subject(input)` is what a rule's `match` is checked against ([117](../../../decisions/rules-are-harness-data.md)).

## Files

- `UPDATE: packages/agents/src/types/tool.ts:31-43` - `ToolDefinition.subject?`.
- `CREATE: packages/agents/src/types/policy.ts` - `Rule`, `RulesOptions`.
- `UPDATE: packages/agents/src/types/index.ts` - export it.
- `CREATE: packages/agents/src/policy/rules.ts` - `rules()`, `matchGlob()`.
- `CREATE: packages/agents/src/policy/rules.test.ts`.
- `UPDATE: packages/agents/src/index.ts` - `export { rules } from './policy/rules.js';`.
- `UPDATE: packages/agents/README.md` - a "Rules" section.

## Steps

1. `types/tool.ts`, on `ToolDefinition` after `effects`:

   ```ts
   /**
    * What a permission rule's `match` is checked against (decision 117): the command for a shell tool,
    * the path for a file tool. Absent: rules on this tool match by name only.
    */
   subject?(input: Input): string;
   ```

2. `types/policy.ts`:

   ```ts
   import type { Policy } from './agent.js';

   /** One permission rule (decision 117): a tool name or `*`, and an optional glob over the tool's subject. */
   export interface Rule { tool: string; match?: string }

   export interface RulesOptions {
     deny?: Rule[];
     ask?: Rule[];
     allow?: Rule[];
     /** Decides when no rule matches; default: ask when destructive, allow otherwise (task 01). */
     otherwise?: Policy['decide'];
   }
   ```

3. `policy/rules.ts`:

   ```ts
   /** `*` any run of characters, `?` one; anchored to the whole subject (decision 117). */
   export function matchGlob(pattern: string, subject: string): boolean {
     const source = pattern.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
     return new RegExp(`^${source}$`, 's').test(subject);
   }

   export function rules(options: RulesOptions): Policy {
     const otherwise = options.otherwise ?? DEFAULT_DECIDE;
     const first = (list: Rule[] | undefined, tool: Tool<any, any>, input: unknown): Rule | undefined =>
       list?.find((rule) => (rule.tool === '*' || rule.tool === tool.name) && (rule.match === undefined || (tool.subject !== undefined && matchGlob(rule.match, tool.subject(input)))));
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
   ```

   `DEFAULT_DECIDE` is the default policy's `decide` moved from `create-agent.ts` into `policy/rules.ts` (or a `policy/default.ts` both import) so the default lives once.

4. `rules.test.ts`: `matchGlob` (`rm *` vs `rm -rf /`, `ls`; `?`; regex metacharacters in a subject; empty pattern); list order (deny before ask before allow); `*` tool; a rule with `match` on a tool without `subject` never matches; `otherwise` is called with the same args; the default `otherwise` asks for a destructive tool.

## Validation

- `pnpm --filter @cofold/agents typecheck` and `rules.test.ts`.

## Resume

- **Done (2026-09-16):** `ToolDefinition.subject?(input)` after `effects` in `types/tool.ts` (`createTool`'s spread carries it, no copy needed); `types/policy.ts` with `Rule` and `RulesOptions`, exported from `types/index.ts`; `policy/rules.ts` with `DEFAULT_DECIDE`, `matchGlob()` and `rules()`; `create-agent.ts` imports `DEFAULT_DECIDE` from `policy/rules.js` (one home for the default, no `policy/default.ts`); `index.ts` exports `rules` and `matchGlob`; README gained a "Rules" section.
- **Evidence:** `rules.test.ts` 10 tests green (glob: `rm *` vs `rm -rf /` and `ls`, anchoring, `?`, regex metacharacters, empty pattern, `*` across newlines; lists: deny before ask before allow, name-only rule, `*` tool, `match` on a tool without `subject` never matches, `otherwise` gets the same args and is not called when a rule matched, the default `otherwise` asks for a destructive tool; `createTool` keeps `subject`); `tools.test.ts` 20 and `create-agent.test.ts` 4 still green. `tsc -p tsconfig.test.json` reports errors only in `src/testing/fake-model.ts`, another session's in-progress edit (agent/01-p5 task 05); none in the files of this task.
- **Deviations:** `matchGlob` is exported from the package too (the plan exports `rules` only): a host that wants to test its own rule lists against a subject needs the same dialect; no second definition. The deny reason reads `Denied by rule: <tool>(<match>)`, as in the plan's code block.
- **Found:** nothing the plan did not know.

