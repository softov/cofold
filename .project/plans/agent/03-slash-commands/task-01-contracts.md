---
title: The slash command contracts
status: done
depends: []
layer: agents
refs:
  - "[code://packages/agents/src/types/agent.ts#L45-L64](../../../../packages/agents/src/types/agent.ts#L45-L64) - `AgentOptions`, which gets `slashCommands`"
  - "[code://packages/agents/src/types/capability.ts#L18-L36](../../../../packages/agents/src/types/capability.ts#L18-L36) - `Capability`, which gets `slashCommands` and `prompts`"
  - "[code://packages/agents/src/types/message.ts#L34](../../../../packages/agents/src/types/message.ts#L34) - `MessageSource`"
  - "[code://packages/agents/src/types/event.ts#L14-L44](../../../../packages/agents/src/types/event.ts#L14-L44) - `RunEventBody`"
---

## Objective

The types for runtime commands, prompt commands, the three new message sources and the two command events exist and are exported.
Nothing runs them yet.

## Files

- `CREATE: packages/agents/src/types/slash-command.ts` - `SlashCommand`, `SlashCommandContext`, `PromptCommand`, `SlashCommandInfo`.
- `UPDATE: packages/agents/src/types/index.ts` - export the new file.
- `UPDATE: packages/agents/src/types/agent.ts:45-64` - `AgentOptions.slashCommands`; `Agent.slashCommands`.
- `UPDATE: packages/agents/src/types/capability.ts:18-36` - `Capability.slashCommands` and `Capability.prompts`.
- `UPDATE: packages/agents/src/types/message.ts:34` - add `command`, `notice` and `skill` to `MessageSource`.
- `UPDATE: packages/agents/src/types/event.ts:14-44` - `command.started` and `command.finished`.
- `UPDATE: packages/agents/src/types/contracts.test-d.ts` - type tests for the new shapes.

## Steps

1. Write `SlashCommand { name; description; argumentHint?; run(ctx: SlashCommandContext): Promise<string | undefined> }`.
2. Write `SlashCommandContext { agent; sessionId; runId; workspace?; args: string; store; kv; signal }`, the same reach as `CapabilityArgs`.
3. Write `PromptCommand { name; description; argumentHint?; expand(args: string): Promise<string> }`.
4. Write `SlashCommandInfo { name; description; argumentHint?; kind: 'runtime' | 'prompt' }`.
5. Add `slashCommands?: SlashCommand[]` to `AgentOptions`, and `readonly slashCommands: readonly SlashCommand[]` to `Agent`.
6. Add `slashCommands?: readonly SlashCommand[]` and `prompts?(args: { workspace?: string }): Promise<PromptCommand[]>` to `Capability`.
7. Add `'command' | 'notice' | 'skill'` to `MessageSource`, with one comment line each from decision 3.
8. Add `{ type: 'command.started'; name: string; args: string }` and `{ type: 'command.finished'; name: string; output?: string }` to `RunEventBody`.
9. Add type tests for each new shape.

## Validation

- `pnpm --filter @cofold/agents typecheck` passes.
- `contracts.test-d.ts` holds a `SlashCommand`, a `PromptCommand` and both events.

## Resume
