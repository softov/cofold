<!--
Domain: cli
Status: Built
Priority: High
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: ./01-papo.md (Built); ../tools/01-standard-tools.md (Built: memory files)
Reference: ./00-cli.md
-->

# CLI-02 - papo slash commands: what `/` offers beyond the settings

_Status: Built (2026-09-16) · Priority: High · Created: 2026-09-16_

## Goal

A person types `/` in papo and gets what every terminal agent client offers: the state of the conversation (`/status`, `/cost`), what the agent can do (`/skills`, `/memory`, `/config`, `/help`), a way to keep or redo a conversation (`/export`, `/retry`, `/clear`), the look (`/theme`), and two prompts shipped with papo (`/init`, `/review`).
Everything is a palette command or a skill, so the `/` menu, the palette and the keys are one list, declared once.
`/compact` and `/autocompact` are not here: context reduction is the harness's p5 Task 6, still an outline; this plan adds nothing to `@facio/agents` beyond one exported helper.

## Reconnaissance

- `packages/papo/src/screen/app.tsx:303-395` - the commands, `slots: ['palette']`; `useSlashCommands` in `chat.tsx` lists them after the skills, so a command added here is a slash command.
- `../textui/packages/core/src/app/app.ts:413` - `app.suspend(run)`: releases the terminal (alt screen, raw mode) around a program that draws for itself, then takes it back and invalidates the buffer. `/memory`'s editor.
- `../textui/packages/widgets/src/overlay/dialog.ts` - `Dialog { title, actions: [{ id, label, tone, onPress }], onClose, width }`; the frame for the information overlays.
- `../ahpc/src/control.ts:1394-1421` - `view.theme` with `args[0].choices = app.themes.list()` and `preview` that wears the theme while the highlight moves; copied.
- `packages/papo/src/commands.ts:358-380` - `renderTurn`, `renderTranscript`: plain text for the shell; the export wants Markdown.
- `packages/agents/src/capabilities/skills.ts:20-32` - the index over several sources, first source wins on a duplicate; papo's `chat.skills()` needs the same list, so it moves out as `listSkills`.
- `packages/agents/src/types/store.ts:143` - `runs.list({ sessionId })` returns `RunRecord.usage` and `steps` per run: `/cost` needs no new service call, only the projection carrying them.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Information overlays are one component, `PapoInfo`, a `Dialog` over `$/papo/info = { title, lines, actions? }`, opened by `showInfo(app, ...)` as a modal layer `papo.info`; `esc` closes. `/status`, `/cost`, `/config`, `/help`, `/memory` and the export's confirmation use it | One overlay declared once; the store is the only state |
| 2 | `Turn` carries `usage: Usage` and `steps: number` from its `RunRecord`; `/cost` lists the turns and the total from the snapshot | The projection already reads the runs |
| 3 | `/status`: session id, title, model, permissions, thinking, workspace, home, turns, total tokens in/out. `/config`: the configuration with keys redacted, as `config.show` prints it | What a person asks first when something looks wrong |
| 4 | `/skills` is the command `chat.skill` with one argument `name` whose choices are `chat.skills()`; choosing one puts `/name ` in the composer. The slash menu opens its picker because the argument has choices | Same mechanism as the settings chips |
| 5 | `/memory` shows `<home>/memory/<workspace slug>/MEMORY.md` with one action, `Edit`, which runs `$VISUAL`, else `$EDITOR`, else `notepad` on Windows and `vi` elsewhere, inside `app.suspend` | The memory files are for hands too (TOOLS-01 decision 8) |
| 6 | `/export [path]`: the conversation as Markdown (`toMarkdown(snapshot)` in `src/export.ts`: `# title`, `## You` / `## papo` per turn, tool calls as `- name(input) → status` lines, errors as blockquotes) to `<workspace>/papo-<sessionId>.md` unless a path is given; the shell gets `session export <id> [-o FILE]` over the same function | One renderer for both fronts |
| 7 | `/retry` sends the last turn's input again as a new turn; refused while a turn runs or waits | The cheapest correction after a bad answer |
| 8 | `/clear` is `session.clear`, "Clear: start a new conversation"; it does what `ctrl+n` does and deletes nothing | Every other client spells it so; papo keeps sessions |
| 9 | `/theme` is `view.theme` as in ahpc, choices from `app.themes.list()`, preview while the highlight moves, `config.theme` the start value | Copied, not reinvented |
| 10 | `/help`: every palette command with its keys, from `app.commands.list` and `app.keybindings.list`, plus the screen keys that are not commands (`tab`, `a`, `d`, `enter`) | One list, generated |
| 11 | Shipped prompts are skills: `packages/papo/skills/init/SKILL.md` (write or refresh `AGENTS.md` from the repository) and `review/SKILL.md` (review the working tree's diff); a second `fileSkillSource({ root: <package dir> })` after the home's, so a person's skill of the same name wins; `files` in `package.json` includes `skills` | No third command kind; the `/` menu shows them like any skill |
| 12 | `listSkills({ sources, workspace, warn? })` is exported from `@facio/agents` and used by the `skills` capability and by `chat.skills()` | One index, one duplicate rule |
| 13 | Not added: `/rename` (no title in the store), `/undo`, `/doctor`, `/mcp` (with the MCP client), `/compact` and `/autocompact` (harness p5 Task 6) | Scope |

## Proposed architecture

```
packages/agents/src/capabilities/skills.ts   UPDATE: listSkills exported; index.ts exports it
packages/papo/skills/{init,review}/SKILL.md  CREATE
packages/papo/src/export.ts                  CREATE: toMarkdown(snapshot)
packages/papo/src/types/turn.ts              UPDATE: Turn.usage, Turn.steps
packages/papo/src/turns.ts                   UPDATE: carry them
packages/papo/src/chat.ts                    UPDATE: two skill sources; skills() via listSkills
packages/papo/src/commands.ts                UPDATE: session export
packages/papo/src/screen/state.ts            UPDATE: INFO path
packages/papo/src/screen/info.tsx            CREATE: PapoInfo, showInfo
packages/papo/src/screen/app.tsx             UPDATE: the commands
packages/papo/src/screen/screen.test.ts      UPDATE: /status, /cost, /help, /skills, /export, /retry, /theme
packages/papo/README.md                      UPDATE
```

## Phases

### Task 1 - usage on turns, export, listSkills, shipped skills

- **Validation:** `toMarkdown` on a snapshot with a tool call and an error; `session export` writes the file and prints the path; `chat.skills()` lists `init` and `review` after the home's, and a home `review` wins.

### Task 2 - the overlay and the commands

- **Validation:** screen tests: `/status` shows the model and the session id; `/cost` shows the token totals; `/help` lists `Quit ctrl+q`; `/skills` picker inserts `/review `; `/export` writes the file and says where; `/retry` sends the last input again; `/theme` changes the theme; `/clear` opens a new conversation; `/config` shows redacted keys.

## Risks and tradeoffs

- `/memory`'s editor is untestable in the harness (`app.suspend` on a virtual terminal runs the function directly); the overlay is tested, the spawn is not.
- The token totals are the providers' counts; a provider that reports nothing shows zeros, which is honest.

## Resume state

- **Done so far:** plan written and Tasks 1-2 built 2026-09-16. `/export` on the screen takes no path (a free-text argument gets no picker; the shell's `-o` does); the overlay is `screen/info.tsx`.
- **Next action:** none here. `/compact` and `/autocompact` wait for harness p5 Task 6; `/mcp` for the MCP client.
- **Open questions:** none.
- **Watch out for:** `app.themes.list()` shape (`{ id }`), `app.keybindings.list()` availability in `@textui/core`.

## Final verification checklist

- [x] `pnpm check` green.
- [x] Every command in the table reachable from `/` and the palette; screen tests cover `/status`, `/cost`, `/config`, `/help`, `/export`, `/retry`, `/theme`, `/clear`, `/skill`.
- [x] `index.md` updated.
