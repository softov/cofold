---
title: The policy decides allow, ask or deny, and a deny beats the hook
status: todo
depends: []
layer: agents
refs:
  - code://packages/agents/src/types/agent.ts#L27-L33 - `Policy { requireApproval }` becomes `Policy { decide }`
  - code://packages/agents/src/agent/create-agent.ts#L15-L17 - `DEFAULT_POLICY`
  - code://packages/agents/src/run/tools.ts#L33-L58 - hook, floor, remembered approval, `executeTool`
  - code://packages/agents/src/agent/create-agent.test.ts#L49-L88 - reads `requireApproval`
  - code://packages/agents/src/run/tools.test.ts#L115-L118 - stubs `requireApproval`
---

## Objective

`Policy.decide` answers `allow`, `ask` or `deny` per call ([116](../../../decisions/policy-decides-allow-ask-deny.md)); `handleToolCall` applies it after the hook with Claude's precedence ([119](../../../decisions/policy-deny-overrides-hook.md)).

## Files

- `UPDATE: packages/agents/src/types/agent.ts:27-33` - `PolicyDecision`, `Policy.decide`; the doc comment on `AgentOptions.policy`.
- `UPDATE: packages/agents/src/agent/create-agent.ts:15-17` - `DEFAULT_POLICY.decide`.
- `UPDATE: packages/agents/src/run/tools.ts:33-58` - the decision block.
- `UPDATE: packages/agents/src/agent/create-agent.test.ts:49-88`, `packages/agents/src/run/tools.test.ts:115-118` - moved to `decide`.
- `UPDATE: packages/agents/src/types/contracts.test-d.ts` - `Policy` has exactly `decide`; `PolicyDecision.behavior` is the three values.
- `UPDATE: packages/agents/README.md` - the policy paragraph.

## Steps

1. `types/agent.ts`:

   ```ts
   /** What the policy says about one call (decision 116). `reason` is what the model and the person read on a deny. */
   export interface PolicyDecision { behavior: 'allow' | 'ask' | 'deny'; reason?: string }

   /**
    * The run-level authorization policy (decisions 46, 116, 119). A hook runs first and may raise a call to `ask`
    * or refuse it; the policy then decides on the possibly modified input, and its `deny` wins over the hook.
    */
   export interface Policy {
     decide(args: { tool: Tool<any, any>; input: unknown; run: RunInfo }): PolicyDecision | Promise<PolicyDecision>;
   }
   ```

   `AgentOptions.policy?: Partial<Policy>` keeps its shape; its comment becomes `/** Default: ask when tool.effects.destructive is true, allow otherwise (decision 116). */`.

2. `create-agent.ts`: `const DEFAULT_POLICY: Policy = { decide: ({ tool }) => ({ behavior: tool.effects.destructive === true ? 'ask' : 'allow' }) };`.

3. `run/tools.ts`, replacing lines 33-58 (`hookWantsApproval` ... `return executeTool(...)`):

   ```ts
   // Hook first: it may deny, stop, modify, or ask (decisions 46, 97). It cannot lower the policy (decision 119).
   let hookWantsApproval = false;
   let prompt: string | undefined;
   if (agent.hooks.beforeTool) {
     const hook = await agent.hooks.beforeTool({ call, tool, run });
     if (hook.decision === 'deny') return deny(hook.reason);
     if (hook.decision === 'stop') { /* unchanged */ }
     if (hook.decision === 'modify') { /* unchanged: re-validate into input */ }
     if (hook.decision === 'approval') { hookWantsApproval = true; prompt = hook.prompt; }
   }
   const decision = await agent.policy.decide({ tool, input, run });
   if (decision.behavior === 'deny') return deny(decision.reason ?? `Denied by policy: ${tool.name}`);
   if (decision.behavior === 'ask' || hookWantsApproval) {
     // A remembered approval (decision 63) answers an ask, never a deny, which returned above.
     const remembered = await run.kv.agent.get<boolean>(`approvals/${run.sessionId}/${tool.name}`);
     if (remembered !== true) return { kind: 'approval', tool, input, ...(prompt !== undefined ? { prompt } : {}) };
   }
   return executeTool(deps, call, tool, input);
   ```

   The `deny` helper is unchanged here; task 02 adds the record.

4. Tests. `tools.test.ts`: the stub becomes `decide: vi.fn(() => ({ behavior: 'allow' }))` and the assertion checks the same arguments; new cases: policy `deny` with a hook `allow` → `tool.denied` with the reason, no execution; policy `deny` with a remembered approval → denied; policy `ask` with a hook `allow` → `{ kind: 'approval' }`; policy `allow` with a hook `approval` → `{ kind: 'approval' }` with the hook's prompt; policy `deny` on a hook-modified input → the policy saw the modified input. `create-agent.test.ts`: `decide` on the default policy answers `ask` for `rm` and `allow` for `echo`; a partial `policy: { decide: () => ({ behavior: 'deny', reason: 'no' }) }` overrides it.

## Validation

- `pnpm --filter @facio/agents typecheck` and the two test files; `pnpm check` is green only after task 04 (papo's `policyOf` compiles against `decide`).

## Resume

