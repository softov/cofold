---
title: AGENT-03.2 - Runtime commands are a fixed list at createAgent; skills are prompt commands the harness expands per session
status: accepted
date: 2026-10-11
refs:
  - "[code://packages/agents/src/types/capability.ts#L18-L36](../../packages/agents/src/types/capability.ts#L18-L36) - `Capability`, which gets `slashCommands` and `prompts`"
  - "[code://packages/agents/src/capabilities/skills.ts#L8](../../packages/agents/src/capabilities/skills.ts#L8) - the rule that tells the model to read a skill on `/<name>`"
  - file:///github/pi/packages/coding-agent/src/core/agent-session.ts - pi: `registerCommand` at load, and `/skill:<name>` expanded by the session
---

## Context

A slash line can name a runtime command, which the harness runs, or a skill, which the model acts on.
Today the model reads a skill itself: the `skills()` rule tells it to call `read_skill` when a message starts with `/<name>`.
Skills are read per run from their sources, so they are not known when the agent is created.

## Decision

Runtime commands come from three places: `AgentOptions.slashCommands`, `Capability.slashCommands`, and the harness's built-ins.
All three are fixed lists, resolved once by `createAgent` into `Agent.slashCommands`.

A prompt command expands into text for the model.
A capability gives its prompt commands through `prompts({ workspace })`, per session.
`skills()` gives one prompt command per skill.
The harness expands `/<skill> args` into a `skill` message that holds the skill's text, after the typed line.
The model does not need to call `read_skill` first.

Source: Softov, 2026-10-11, asked "How do capabilities and skills add slash commands in cofold?": "pi's shape".
Source: Softov, 2026-10-11, asked "How does a /skill reach the model?": "Runtime expands it".

## Consequences

`listSlashCommands(agent)` is synchronous and needs no session.
`listPromptCommands(agent, { workspace })` is asynchronous, as `Chat.skills()` is today.
An MCP capability can later give a server's prompts through `prompts`.
A capability command cannot depend on the run, so `memory()` can bring `/memory` but not a list read from the workspace.

## Options

Every command per run, from each capability: one mechanism, but the menu needs a session and can fail when a source is down.
Commands from the program and the built-ins only: `memory()` could not bring `/memory`, and skill expansion would be a special case in the harness.
The model reads the skill, as today: one more model step, and a model that ignores the rule does not read the skill.
