# @doopx/terminal

**The terminal rendering of a command registry.**

argv in, one of three output shapes out, and nothing about what the commands mean: the standard global options, help derived from the declaration, completion asked of the running program, and an exit code taxonomy a script can switch on.

```ts
import { Program, runEntry } from "@doopx/terminal";
```

Depends on [`@doopx/commands`](../commands); part of the [facio](https://github.com/softov/facio) family.
The manual page is [`docs/commands/05-output.md`](../../docs/commands/05-output.md); the whole framework is described in [`@doopx/commands`](../commands).

## License

MIT
