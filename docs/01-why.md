# Why

Not because parsing is hard. Parsing is the solved part.

Look at what a real CLI actually contains. Take any program that has been maintained for a year and count the lines that are *about* its commands versus the lines that are about being a program at all:

- loading a config file, and a profile or target within it
- credentials, and never printing them in an error
- `--json` that stays stable, `--quiet` that prints one identifier
- exit codes a script can switch on
- reading stdin when something is piped in
- `NO_COLOR`, TTY detection, terminal width
- shell completion that knows this installation's ids, not just the flag names
- a reference document that is still true
- and now: MCP tools, for the agent that will drive it

Commander gives you the first third of the first line. Everything else, every program writes again. I have written it twice in the last year - once in `advisor`, once in `tasker` - and the second time was a copy of the first with the names changed.

## The structural problem

```js
program
  .command("note list")
  .description("List notes")
  .option("-n, --limit <n>", "How many")
  .action(async (options) => { /* ... */ });
```

The description is a string passed to a builder. The behaviour is a closure. After this call returns, there is nothing left to *ask*: no object that knows this command exists, what it takes, what it means, or what it needs. So:

- **help drifts**, because a usage line is a comment and comments rot
- **there is no second surface**, because you cannot enumerate what was never kept
- **cross-cutting behaviour has nowhere to live**, so `--json` is re-implemented per action, and one of them prints a stray `console.log`
- **nothing can be checked**, because there is no registry to check against

## What the alternatives do about it

| | |
|---|---|
| **commander** | the model above. Ubiquitous, tiny, and structurally unable to generate a second surface |
| **yargs** | large; coercion is magic (`--a.b=1` silently becomes an object); the types are a fight |
| **oclif** | class per command, its own build step, a plugin manifest, opinionated directories. Good completion and docs - but you buy the whole framework |
| **clipanion** | decorators and classes, Yarn-shaped; the declaration is a class body, which is data you cannot pass around |
| **citty** | minimal and pleasant, and stops exactly where the interesting part starts: no capability lifecycle, no output contract |
| **cobra** (Go) | the closest to right, and the proof this works: the registry is data, and it ships completion *and* docs generation from it |

None of them owns the boring 70%. That is the gap.

## The bet

Keep the declaration. Make everything else a rendering of it.

The cost is a constraint on handlers: a handler receives a canonical input object and returns a value, rather than reading `process.argv` and printing. That is the whole discipline, and everything in this library falls out of it - because a handler that never touches the terminal can be run by something that is not a terminal.

The test of the bet is [`softcli/mcp`](../src/mcp): a complete MCP surface, including JSON Schema generation, in about 170 lines with no dependencies. It is that small because it had nothing to invent - the commands already knew.
