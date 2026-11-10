---
title: copapo hands a task to a subagent
created: 2026-11-10
refs:
  - git://3551a23 - the commit of cofold the facts were checked at
  - "[code://packages/agents/src/types/run.ts#L8-L21](../../packages/agents/src/types/run.ts#L8-L21) - RunArgs: a run is an agent, a session id and an input"
  - "[code://packages/agents/src/types/store.ts#L7-L26](../../packages/agents/src/types/store.ts#L7-L26) - SessionRecord: no link to a parent session"
  - "[code://packages/agents/src/run/pause.ts](../../packages/agents/src/run/pause.ts) - pauseForInput: a tool pauses its run for the person's input"
  - "[code://packages/agents/src/types/capability.ts#L14-L41](../../packages/agents/src/types/capability.ts#L14-L41) - Capability: contributes tools and an instructions section"
  - "[code://.project/plans/index.md#L77](../../.project/plans/index.md#L77) - the subagent tool, named as later work in the harness's first plan"
  - "[code://.project/plans/cli/03-papo-claude/deferred.md#L12](../../.project/plans/cli/03-papo-claude/deferred.md#L12) - the claude backend skips subagent transcripts"
  - "[code://.project/briefs/copapo-loads-the-folder-it-trusts.md](copapo-loads-the-folder-it-trusts.md) - the agent definitions this brief runs, and the `/agents` menu"
  - https://code.claude.com/docs/en/sub-agents - Claude Code subagents, checked 2026-11-10
  - https://opencode.ai/docs/agents/ - OpenCode's `subagent` mode and tool, checked 2026-11-10
---

# copapo hands a task to a subagent

Softov said on 2026-11-10: "I think we need a subagent on cofold also."
The goal is that the main agent hands one task to another agent, and gets back its answer.
The other agent works in its own context, with its own prompt, tools and model, so the main conversation stays short.
The agents come from the definitions that the brief `copapo-loads-the-folder-it-trusts.md` loads.

## What others do

- **Claude Code** delegates to a subagent by its `description`, when the person names it, or by an `@` mention.
  - The subagent works in its own context and returns only a summary to the main conversation.
  - A subagent runs in the foreground, which blocks the main conversation, or in the background, alongside it.
  - A foreground subagent's permission prompts reach the person as they come. A background one's prompt shows in the main session with the subagent's name.
  - A subagent can start subagents of its own, up to three levels below the main conversation. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes the limit.
  - Each subagent's transcript is its own file, `~/.claude/projects/<project>/<sessionId>/subagents/agent-<agentId>.jsonl`.
- **OpenCode** runs an agent whose `mode` is `subagent` or `all` through its `subagent` tool, in a child session with fresh context. The parent's `subagent` permissions say which agents it may start.
- **pi** has no subagents.

## What cofold has today

- cofold has no subagent. The harness's first plan named a subagent tool as later work, and no plan took it.
- A run is an agent, a session id and an input ([`code://packages/agents/src/types/run.ts#L8-L21`](../../packages/agents/src/types/run.ts#L8-L21)). A tool can start a run of another agent in another session with the same store.
- A session record has no link to a parent session or to the tool call that started it.
- A tool can pause its run for the person's input with `pauseForInput`. Nothing passes a child run's approval or question up to the parent's.
- A `Capability` contributes tools and an instructions section, which is the place for one `subagent` tool and the index of agents it can start.
- The claude backend runs the Claude CLI's own subagents, and its projection skips their transcripts.

## Who writes

- `main` at `3551a23` is the only line of work in cofold.
- The working tree holds an uncommitted copapo fix. This change touches `@cofold/agents` and copapo's chat service and screen, so it starts after that fix is committed.
- It needs the agent definitions from the brief `copapo-loads-the-folder-it-trusts.md`, so it is built after that one.

## The change

- `@cofold/agents` has a subagent capability. It contributes one tool that starts a named agent on a task and returns the agent's final answer as the tool output.
- The instructions section lists each agent the tool can start, with its `description`, so the model knows when to delegate.
- The child runs in its own session in the same store. The session record names its parent session and the tool call that started it.
- The child's prompt, tools and model come from its definition. A definition with no `tools` or `model` takes the parent's.
- A child's approval or question pauses the parent's turn, and the answer goes back to the child.
- copapo shows a subagent call as a tool call that names the agent, and the person can open the child's transcript from it.
- A definition says which roles it takes, as OpenCode's `mode` does: the conversation's agent, a subagent, or both.

## Open points

- How deep subagents nest: one level, or more with a limit, as Claude Code allows three.
- Whether a subagent can run in the background, beside the main turn, or always blocks it.
- Whether the child's usage counts in the parent session's usage.
- Whether the parent's permission rules and mode bind the child, or the child's definition sets its own.
- How `copapo acp` shows a subagent: one ACP tool call with the child's answer, or the child's updates as well.
- Whether the claude backend's subagent transcripts are projected in the same change.
