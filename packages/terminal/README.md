# @cofold/terminal

[![npm](https://img.shields.io/npm/v/%40cofold%2Fterminal)](https://www.npmjs.com/package/@cofold/terminal)
[![CI](https://github.com/softov/cofold/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/cofold/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

**The terminal rendering of a command registry.**

argv in, one of three output shapes out, and nothing about what the commands mean: the standard global options, help derived from the declaration, completion asked of the running program, and an exit code taxonomy a script can switch on.

```ts
import { Program, runEntry } from "@cofold/terminal";
```

Before a command whose `effect` is `remove`, the program asks on the terminal; `--yes` skips the question, and without a terminal the command is refused unless `--yes` is given.

Under `--json`, a failure is one flat JSON line on stderr: `{ message, kind, exitCode }`, with `missing` on an authorization failure.

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/05-output.md`](../../docs/commands/05-output.md); the whole framework is described in [`@cofold/commands`](../commands).

## Prompts

Inline questions for a command that wants to ask more than yes or no: `select`, `multiselect`, `text` and `confirm`, grouped under an `intro` and an `outro`, with a `group` that draws a task as a spinner or a list of rows.

```ts
import { createPrompts, PromptCancelled } from "@cofold/terminal";

const ui = createPrompts({ input: process.stdin, output: process.stdout });
const name = await ui.text({ message: "Name" });
```

The block is redrawn in place and collapsed to its answer once chosen. Keys typed ahead are kept for the next question. Glyphs fall back to ASCII and colour follows `NO_COLOR`, `FORCE_COLOR` and `TERM=dumb`. A list taller than the terminal shows a window around the cursor, with a count of the choices above and below it. With `numbers: true`, on `createPrompts` for every list or on one `select` or `multiselect`, each choice is numbered and typing its number moves the cursor to it. Escape, ctrl-c and ctrl-d throw `PromptCancelled`; without a terminal a question rejects with `NO_TERMINAL`, so check `ui.interactive` first. A worked flow is in [`examples/commands/wizard`](../../examples/commands/wizard).

## License

MIT
