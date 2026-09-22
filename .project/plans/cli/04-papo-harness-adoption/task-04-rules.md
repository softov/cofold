---
title: Permission modes as Claude's, and rules in the config and per session
status: done
depends: [task-03-view-and-stop-reasons.md]
layer: papo
refs:
  - code://packages/papo/src/config.ts#L28-L29,L98 - the schema's `permissions` (`ask | destructive | auto`) and the defaults
  - code://packages/papo/src/types/config.ts#L59 - `PapoConfig`
  - code://packages/papo/src/types/settings.ts#L12-L20 - `Settings`
  - code://packages/papo/src/agent.ts#L33-L39,L80 - `policyOf`, `policy:` in `buildAgent`; `capabilitiesOf` already receives `workspace`
  - code://packages/papo/src/chat.ts#L276 - `approve({ always })` → harness `alwaysApprove`
  - code://packages/papo/src/commands.ts#L282 - `session.set`
  - code://packages/papo/src/screen/chat.tsx#L40-L48 - the `compose.permissions` chip that lists the modes
  - code://packages/papo/src/claude/permissions.ts - the Claude backend's mode is passed through as the SDK's `permissionMode`
  - code://.project/plans/agent/04-policy-rules/plan.md - `rules()`, `Rule`, `Tool.subject`; agent/04 task 04's `policyOf` on the old three modes is what this task replaces
  - code://.project/plans/cli/03-papo-claude/plan.md#L94-L112 - finding F8
  - code://claude-code/src/types/permissions.ts#L16-L22 - `EXTERNAL_PERMISSION_MODES`: `acceptEdits, bypassPermissions, default, dontAsk, plan`; `auto` behind a feature flag
  - code://claude-code/src/utils/permissions/permissions.ts#L1163-L1300 - `hasPermissionsToUseToolInner`: deny rules, ask rules, the tool's own check, bypass, allow rules, passthrough → ask
  - code://claude-code/src/utils/permissions/permissions.ts#L503-L515 - `dontAsk`: an `ask` becomes `deny` at the end
  - code://claude-code/src/utils/permissions/filesystem.ts#L1361-L1375 - `acceptEdits`: a file write inside the working dir is allowed
  - code://claude-code/src/utils/attachments.ts#L1255-L1262 - `plan` is a prompt-level mode (attachments, `ExitPlanMode`), not a permission behavior
---

## Objective

papo's permission modes are Claude's (cli/03 F8), mapped onto `decide()`, `ToolEffects` and `rules()`; rule lists live in the config and per session, merged and handed to `rules()` ([CLI-04.5](../../../decisions/papo-rules-in-config-and-session.md)); the shell edits and lists them; `always` adds to the session's allow list.

## Files

- `UPDATE: packages/papo/src/config.ts:28-29,98` and `types/config.ts:59` - `permissions: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'` (default `'default'`); `permissions.rules?: { deny?: Rule[]; ask?: Rule[]; allow?: Rule[] }` in the schema (`Rule` as `{ tool: string, match?: string }`).
- `UPDATE: packages/papo/src/types/settings.ts:12-20` - `Settings.permissions` takes the new union; `Settings.rules?: same shape`.
- `UPDATE: packages/papo/src/agent.ts:33-39,80` - `policyOf(mode, workspace)` returns the `otherwise` and the mode's own rules; `buildAgent` passes `rules({ deny: [...session, ...config], ask: [...], allow: [...mode, ...session, ...config], otherwise })`.
- `UPDATE: packages/papo/src/chat.ts:276` - `approve({ always })` appends `{ tool: <pending call's name> }` to `Settings.rules.allow` instead of `alwaysApprove` (as Claude's `updatedPermissions`, CLI-04.5).
- `UPDATE: packages/papo/src/claude/chat.ts` (where `permissionMode` is built) - the same four names pass straight through to the SDK; the old mapping from `ask | destructive | auto` goes.
- `UPDATE: packages/papo/src/screen/chat.tsx:40-48`, `screen/app.tsx` - the permissions chip and picker list the four modes.
- `UPDATE: packages/papo/src/commands.ts:282` - `session set --permissions <mode>` accepts the four; `--deny <rule>... --ask <rule>... --allow <rule>...` (`Tool` or `Tool(match)`, parsed by one `parseRule(text)`); `session rules <id>`.
- `UPDATE: packages/papo/src/config.test.ts`, `chat.test.ts`, `chat-contract.test.ts`, `commands.test.ts`, `README.md`.

## Steps

1. Modes (cli/03 F8). `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'`; `ask`, `destructive` and `auto` are removed from the schema, the settings and the screen (a config that still names one fails validation with the four names in the message).
   `plan` is not built: in Claude it is a prompt-level mode (an instruction not to edit plus `ExitPlanMode`), which needs agent/03's commands; it waits for a later plan.
   `auto` is a classifier behind a feature flag; not offered.
   `policyOf(mode, workspace): { otherwise: Policy['decide']; allow: Rule[] }`:

   ```ts
   /** Claude's read-tools-run, everything-else-asks (cli/03 F8): allow when the tool only reads. */
   const byEffects: Policy['decide'] = ({ tool }) => {
     const { reads, writes, destructive, network } = tool.effects;
     return { behavior: reads === true && writes !== true && destructive !== true && network !== true ? 'allow' : 'ask' };
   };

   export function policyOf(mode: PermissionMode, workspace: string): { otherwise: Policy['decide']; allow: Rule[] } {
     switch (mode) {
       case 'default': return { otherwise: byEffects, allow: [] };
       case 'acceptEdits': return { otherwise: byEffects, allow: [{ tool: 'write_file', match: `${workspace}/*` }, { tool: 'edit_file', match: `${workspace}/*` }] };
       case 'bypassPermissions': return { otherwise: () => ({ behavior: 'allow' }), allow: [] };
       case 'dontAsk': return { otherwise: async (args) => { const d = await byEffects(args); return d.behavior === 'ask' ? { behavior: 'deny', reason: `${args.tool.name} would need approval and the mode is dontAsk` } : d; }, allow: [] };
     }
   }
   ```

   `match` is checked against the tool's `subject` (the path, decision 117), so `acceptEdits` allows edits inside the workspace and asks outside it, as `filesystem.ts:1367` does; `shell_exec` keeps asking under `acceptEdits` (Claude allows a short command list there; not mirrored, a rule can add it).
   Deny and ask rules run before `otherwise` inside `rules()`, so under `bypassPermissions` a `deny` or an explicit `ask` rule still wins, as in `permissions.ts` steps 1a-1f.
   `dontAsk` turns only the mode's own `ask` into `deny`; an explicit `ask` rule still asks, as Claude's does (`permissions.ts:503`, the transform runs on the final result; `(defaulted: an ask rule under dontAsk asks rather than denies; erase if wrong)`).
2. Schema and types as in Files; an invalid rule (empty tool, malformed `Tool(match)`) is a config error at load, a shell error at `session set`.
3. `buildAgent` merges: `allow` is the mode's rules, then the session's, then the config's; `deny` and `ask` are the session's then the config's; the policy is `rules({ deny, ask, allow, otherwise })`.
4. `approve({ always })` writes the allow rule to the session settings and submits a plain `approve`; the harness's remembered approval is no longer written by papo.
5. The Claude backend passes the mode name through as `permissionMode`; `chat-contract.test.ts` runs the permission scenarios on both backends with the same four names.
6. Tests: `default` asks for `write_file` and `web_fetch` and runs `read_file`; `acceptEdits` runs `write_file` inside the workspace and asks outside it, still asks for `shell_exec`; `bypassPermissions` runs `shell_exec` but a config `deny: [{ tool: 'shell_exec', match: 'rm *' }]` still refuses `rm -rf /`; `dontAsk` denies `write_file` with the reason and runs `read_file`; `session set --allow read_file` then `read_file` under `default` runs without asking; `always` on a confirmation adds the allow rule and the next call runs; `session rules` lists mode, config and session rules with their origin.

## Validation

- `pnpm check`; `papo session set s --permissions acceptEdits` then a turn that edits a file in the workspace runs without asking and one that runs `rm` asks; `--deny 'shell_exec(rm *)'` then a turn that tries `rm` shows the denial with its reason.

## Resume

- **Stopped at step 1 (2026-09-16), before any code:** the `acceptEdits` allow rule `{ tool: 'write_file' | 'edit_file', match: \`${workspace}/*\` }` is checked against the tool's `subject`, and `packages/tools/src/files.ts` returns the raw input `path` for `read_file`, `write_file` and `edit_file` (`subject: (input) => input.path`; the schema says "Absolute, or relative to the workspace", and the tools' own rules text tells the model relative paths resolve against the workspace).
  Checked with `matchGlob` from the built `@doopx/agents` and `resolveWithin` from `@doopx/tools`, workspace `/work`, rule `/work/*`:
  `src/a.ts` (inside) does not match, so an edit the model makes the way it is told to would ask under `acceptEdits`;
  `/work/../etc/passwd` (outside) matches, so an edit outside the workspace would run unasked;
  `/work/src/a.ts`, `../other/x` and `/work2/a.ts` come out right.
  With the resolved absolute path as the subject (`resolveWithin(workspace, input.path).absolute`) and the rule `\`${resolve(workspace)}${sep}*\``, all five come out right (`..` is resolved away, the separator bounds the workspace).
  The glob dialect (`*`, `?`, anchored) cannot express "relative and not climbing out", so no rule over the raw path is reliable.
- **The fork (not chosen here):** (a) change the three path tools' `subject` in `packages/tools/src/files.ts` to the resolved absolute path (`at(input.path)`), the subject then being what the tool will touch, as decision 117's "the path for a file tool" reads; `files.test.ts`'s subject assertions change with it; papo's rule becomes `match: \`${resolve(workspace)}${sep}*\`` (also what a person writes in a config rule for a path); a change outside `packages/papo`, which this session was told not to make without asking.
  (b) keep the raw subject and make `acceptEdits` an `otherwise` in papo that calls `resolveWithin(workspace, input.path).inside` for `write_file` / `edit_file`; no package but papo changes, but the mode's grant is then not a `Rule` and `session rules` cannot list it, and a config rule on a path stays unreliable.
  Recommendation: (a).
- **Answered (user, 2026-09-16, "Normalized subject + mode check"; decision [CLI-04.6](../../../decisions/tool-subject-normalized-path.md)) and built the same day:**
  `packages/tools/src/files.ts`: `read_file`, `write_file`, `edit_file` declare `subject: displayPath(workspace, resolveWithin(workspace, input.path).absolute)` (relative with forward slashes inside the workspace, absolute outside); `files.test.ts` asserts `src/a.ts`, the absolute spelling of the same file, `./out.txt`, `src/../out.txt` and `../outside/x.ts`; the tools README says so.
  `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'` (`types/config.ts`), `RuleLists = Pick<RulesOptions, 'deny' | 'ask' | 'allow'>`, `PapoConfig.rules?`, `Settings.rules?`, `PERMISSION_MODES`; the schema's `permissions` enum names the four (an old name fails at load with them in the message) and `rules` holds three arrays of `{ tool, match? }`; `BASE.permissions` is `default`.
  `agent.ts`: `byEffects` (ask when `writes`, `destructive` or `network`; allow otherwise), `policyOf(mode, workspace): Policy['decide']` (`default` → `byEffects`; `acceptEdits` → allow `write_file` / `edit_file` when `resolveWithin(workspace, path).inside`, else `byEffects`; `bypassPermissions` → allow; `dontAsk` → `byEffects` with its `ask` turned into `deny` with the reason), `mergedRules(session, config)` (session first, per list), `buildAgent` passes `rules({ ...merged, otherwise: policyOf(...) })`.
  `rules.ts` (new, papo): `parseRule` (`Tool` or `Tool(match)`), `formatRule`, `checkRules`; `chat.ts` and `claude/chat.ts` check `rules` patches with it; `settingsOf` carries the session's `rules`.
  `chat.ts` `approve({ always })`: `allowAlways` appends `{ tool }` to the session's `rules.allow` (not repeated when there) and submits a plain `approve`; `alwaysApprove` is no longer written.
  Claude backend: `permissionMode: chosen.permissions` (with `allowDangerouslySkipPermissions: true` under `bypassPermissions`, which the SDK requires), `Live.mode`, a mode change restarts the process as an effort change does; the `auto` shortcut and the `ask` warning are gone; the fake SDK asks nobody about a tool under `bypassPermissions` (the question tool still asks).
  Shell: `-p` takes the four; `session set --deny/--ask/--allow RULE` (repeatable) appends parsed rules to the session's lists (a rule already there is not repeated; malformed text is an argument error); `session rules <id>` prints `mode <mode>` and one row per rule (`list origin Tool(match)`, session rows before config rows per list, or `no rules`), `--json` gives `{ mode, rules: [{ list, origin, tool, match? }] }`; `renderSettings` appends the session's rules.
  Screen: `PERMISSION_LABELS` for the four (`Ask before changes`, `Accept edits`, `Bypass permissions`, `Don't ask`); the chip and picker list them.
  README: the `permissions` and `rules` rows, *Tools, the permission mode and the rules*, the shell lines, the Claude backend row.
- **Evidence:** `@doopx/tools` 4 files, 24 tests; `@doopx/papo` 8 files, 117 tests: `chat.test.ts` (`default` runs `read_file` and asks for `write_file` then `web_fetch`; `acceptEdits` writes `sub/../out.txt` and edits `notes.md` unasked, asks for a path outside the workspace and for `shell_exec`; `bypassPermissions` runs `delete_file` and a config `deny: [{ tool: 'delete_file', match: 'prec*' }]` still refuses it with `Denied by rule: delete_file(prec*)`; `dontAsk` refuses `delete_file` with the reason and the question still reaches the person; a session allow rule and `always` let `delete_file` run under `default`, `always` written as `rules.allow`), `commands.test.ts` (`session set` with the three flags, no repeats, malformed and empty-match errors, `session rules` text and `--json`, config rows after session rows, an allow rule making `say` run the tool), `config.test.ts` (the four names in the error, the old names refused, `rules` read and each malformed shape named), `chat-contract.test.ts` (`rules` as a setting on both backends), `claude/chat.test.ts` (pass-through, the restart on a mode change with the flag), `screen.test.ts` (the labels in the picker).
  `pnpm check` after task 04: see the plan's checklist.
- **Deviations:** `byEffects` allows a tool that declares no effect at all (`ask_user`, `load_tools`), where the plan's block required `reads === true`: under it a question would have waited for an approval, which Claude's `AskUserQuestion` never does, and `chat.test.ts`'s question scenarios showed it.
  `policyOf` returns the `decide` alone, not `{ otherwise, allow }`: with `acceptEdits` a check (CLI-04.6) no mode owns a rule list, so `allow` was always empty (the coordinator allowed dropping it).
  The config key is `rules`, a sibling of `permissions`, where CLI-04.5 and the task wrote `permissions.rules`: `permissions` is the mode string in the file and in `Settings` (`Settings.rules` is the sibling the task itself named), so the rules of the permissions sit next to the mode under their own key `(defaulted: the key name; erase if wrong)`.
  The mode is passed to the CLI as a process option and a change restarts the process rather than `setPermissionMode`: `bypassPermissions` needs `allowDangerouslySkipPermissions` in the options, which cannot be set live.
  Claude's short `acceptEdits` command list for `shell_exec` is not mirrored (as the plan said); a rule can add it.
- **Found, not decided:** under `default`, `memory_write` (`effects.writes`) now asks, where papo's old `destructive` mode let it run; Claude's runtime writes its own memory files unasked. A config or session `allow: [{ tool: 'memory_write' }]` restores it; whether papo should ship that by default is a question for the user.
  Whether the real CLI lets `AskUserQuestion` reach `canUseTool` under `bypassPermissions` is not verified (the fake assumes it does, as the old papo comment assumed the opposite).
- **Not run:** the terminal check of *Validation* (LM Studio; `--deny 'shell_exec(rm *)'` on a real shell).
