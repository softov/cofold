---
title: Permission rules in the config and per session
status: todo
depends: [task-03-view-and-stop-reasons.md]
layer: papo
refs:
  - code://packages/papo/src/config.ts#L28-L29,L98 - the schema's `permissions` and the defaults
  - code://packages/papo/src/types/config.ts#L59 - `PapoConfig`
  - code://packages/papo/src/types/settings.ts#L12-L20 - `Settings`
  - code://packages/papo/src/agent.ts#L33-L39,L80 - `policyOf`, `policy:` in `buildAgent`
  - code://packages/papo/src/chat.ts#L276 - `approve({ always })` → harness `alwaysApprove`
  - code://packages/papo/src/commands.ts#L282 - `session.set`
  - code://.project/plans/agent/04-policy-rules/plan.md - `rules()`, `Rule`, `Tool.subject`
---

## Objective

Decision [CLI-04.5](../../../decisions/papo-rules-in-config-and-session.md): rule lists in the config and per session, merged and handed to `rules()`; the shell edits and lists them; `always` adds to the session's allow list.

## Files

- `UPDATE: packages/papo/src/config.ts:28-29,98` and `types/config.ts:59` - `permissions.rules?: { deny?: Rule[]; ask?: Rule[]; allow?: Rule[] }` in the schema (`Rule` as `{ tool: string, match?: string }`).
- `UPDATE: packages/papo/src/types/settings.ts:12-20` - `Settings.rules?: same shape`.
- `UPDATE: packages/papo/src/agent.ts:33-39,80` - `policyOf(mode)` returns `decide`; `buildAgent` passes `rules({ deny: [...session, ...config], ask: [...], allow: [...], otherwise: policyOf(mode).decide })`.
- `UPDATE: packages/papo/src/chat.ts:276` - `approve({ always })` appends `{ tool: <pending call's name> }` to `Settings.rules.allow` instead of `alwaysApprove` `(defaulted in the decision file)`.
- `UPDATE: packages/papo/src/commands.ts:282` - `session set --deny <rule>... --ask <rule>... --allow <rule>...` (`Tool` or `Tool(match)`, parsed by one `parseRule(text)`), `session rules <id>`.
- `UPDATE: packages/papo/src/config.test.ts`, `chat.test.ts`, `commands.test.ts`, `README.md`.

## Steps

1. Schema and types as in Files; an invalid rule (empty tool, malformed `Tool(match)`) is a config error at load, a shell error at `session set`.
2. `buildAgent` merges session lists before config lists per behavior and builds the policy with `rules()`; `permissions: auto` still means `otherwise` allows, but a `deny` rule still refuses (decision 119's order inside the harness).
3. `approve({ always })` writes the allow rule to the session settings and submits a plain `approve`; the harness's remembered approval is no longer written by papo.
4. Tests: a config `deny: [{ tool: 'shell_exec', match: 'rm *' }]` refuses `rm -rf /` under every mode and lets `ls` ask under `destructive`; `session set --allow read_file` then a `read_file` under `ask` runs without asking; `always` on a confirmation adds the allow rule and the next call runs; `session rules` lists config and session rules with their origin.

## Validation

- `pnpm check`; `papo session set s --deny 'shell_exec(rm *)'` then a turn that tries `rm` shows the denial with its reason.

## Resume

