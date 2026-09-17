---
title: CLI-04.5 - Permission rules live in papo's config and per session; always adds a session allow rule
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/config.ts#L28,L98 - `permissions: 'ask' | 'destructive' | 'auto'` and its default
  - code://packages/papo/src/types/settings.ts#L12-L16 - `Settings { model, permissions, reasoning }` per session (cli/01 decision 18)
  - code://packages/papo/src/agent.ts#L33-L39,L80 - `policyOf(mode)` handed to `createAgent`
  - code://packages/papo/src/chat.ts#L276 - `approve({ always })` writes the harness's `alwaysApprove`
  - code://.project/decisions/rules-are-harness-data.md - decision 117: `rules()` and `Rule { tool, match? }`
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2403 - Claude keeps rules per settings scope and per session
  - code://packages/papo/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L221-L224,L2375 - `always` in Claude: the CLI's `suggestions` returned as `updatedPermissions`, an `addRules` update with destination `session`
---

## Context

agent/04 gives the harness `rules()`; papo needs a place for the lists.
Claude keeps rules in settings files and in the session, and "always" is a rule added to the session.

## Decision

`permissions.rules: { deny?: Rule[]; ask?: Rule[]; allow?: Rule[] }` in `config.json` / `.papo.json` next to the mode, validated by the schema.
`Settings.rules` per session with the same shape, merged over the config's (session lists first, then the config's, per behavior).
`buildAgent` passes `rules({ ...merged, otherwise: policyOf(mode).decide })`.
Shell: `session set <id> --deny 'shell_exec(rm *)' --ask ... --allow ...` (each repeatable; `Tool(match)` or `Tool`) and `session rules <id>` to list them.
The `always` option of a confirmation adds `{ tool }` to the session's `allow` list, as Claude's `updatedPermissions` does; papo stops writing the harness's `alwaysApprove`, which stays for other hosts.

Source: user, 2026-09-16, asked "Config file only / Config plus per-session setting".
The `always` mapping follows the reference (`sdk.d.ts#L221-L224`).

## Consequences

One list holds every session grant.
The screen gets no chip for rules in this plan (the shell edits them).
The permission mode set becomes Claude's four (cli/03 F8, cli/04 task 04); the rules and `always` here hold under every mode.

## Options

Config only had no place for a grant given during a session.
