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

Depends on [`@cofold/commands`](../commands); part of the [cofold](https://github.com/softov/cofold) family.
The manual page is [`docs/commands/05-output.md`](../../docs/commands/05-output.md); the whole framework is described in [`@cofold/commands`](../commands).

## License

MIT
