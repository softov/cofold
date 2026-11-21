# wizard

A configure flow built on the prompts of [`@cofold/terminal`](../../../packages/terminal): `select`, `multiselect`, `text`, `confirm`, a titled block of lines, and a task with a spinner, drawn in a `◆ │ ◇ └` frame. The data is a stand-in, so the prompts can be tried in a real flow.

```bash
pnpm examples
node examples/commands/dist/wizard/cli.js configure --config-file /tmp/wizard.json
```

Run it a second time with the same file to see the reconfigure path: it asks which section to change, then reviews the difference before writing.

| File | What it is |
| --- | --- |
| `flow.ts` | The configure flow, against four seams (`read`, `write`, `install`, `detect`). |
| `catalogue.ts` | Stand-in plugins and ACP agents. |
| `cli.ts` | The flow as a `@cofold/commands` action. |

Behaviour worth knowing:

- Inline, not full screen. A prompt redraws its own block on each key and leaves one collapsed answer in the scrollback.
- Lines are cut to the terminal width, because a wrapped line breaks the count the redraw moves up by.
- `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and a pipe decide colour. `TERM=linux`, a non-UTF-8 locale and the legacy Windows console get ASCII marks.
- Ctrl+C, Ctrl+D and Escape cancel with `PromptCancelled`. Without a terminal a question refuses and the flow refuses before it prints.
- Keys typed ahead are kept for the next prompt.

Not done yet: a list taller than the terminal does not scroll, and there is no Windows run.
