---
title: The harness expands a skill
status: todo
depends: [task-01-contracts.md]
layer: agents
refs:
  - "[code://packages/agents/src/capabilities/skills.ts](../../../../packages/agents/src/capabilities/skills.ts) - `skills()`, its rule and `read_skill`"
  - "[code://packages/agents/src/run/run.ts#L71-L115](../../../../packages/agents/src/run/run.ts#L71-L115) - `setupRun`, where a prompt command is expanded"
---

## Objective

`/<skill> args` puts the skill's text in the turn as a `skill` message, after the typed line, before the first model step.
The model acts on the skill without a `read_skill` call first.

## Files

- `UPDATE: packages/agents/src/capabilities/skills.ts` - `prompts({ workspace })`, one prompt command per skill; the rule no longer asks the model to read a skill on `/<name>`.
- `UPDATE: packages/agents/src/run/slash.ts` - `listPromptCommands(agent, { workspace })`.
- `UPDATE: packages/agents/src/run/run.ts:71-115` - expand a prompt command in `setupRun`.
- `UPDATE: packages/agents/src/index.ts` - export `listPromptCommands`.
- `UPDATE: packages/agents/src/capabilities/skills.test.ts` - the cases under Validation.

## Steps

1. In `skills()`, add `prompts({ workspace })`, which lists the skills with `listSkills`.
2. Make each prompt command's `expand(args)` read the skill's `SKILL.md` and return `<skill name="...">`, the text, `</skill>`, then `args` when not empty.
3. Change the `skills()` rule so that it no longer tells the model to read a skill on `/<name>`.
4. Write `listPromptCommands(agent, { workspace })`, which joins each capability's `prompts` and gives `kind: 'prompt'`.
5. In `setupRun`, when no runtime command matches, look up the name in `listPromptCommands` for the session's workspace.
6. For a match, write the input message as usual and a `skill` message with the expanded text after it.
7. When `expand` throws, write the input as usual, send `agent.warn` the reason, and go on without the skill.

## Validation

- `skills.test.ts`: `/review x` writes an `input` and a `skill` message, and the first request carries both.
- `skills.test.ts`: a name that is a runtime command and a skill runs the runtime command.
- `skills.test.ts`: `listPromptCommands` lists each skill once, with its description.
- `pnpm --filter @cofold/agents test` passes.

## Resume
