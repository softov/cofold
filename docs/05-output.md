# Output and failure

## Three readings of one result

```ts
return output(
  notes,                                     // data: what --json prints, and what MCP returns
  () => renderTable(["id", "title"], rows),  // plain: what a person sees
  notes.map((note) => note.id).join("\n"),   // quiet: what a shell script consumes
);
```

The caller picks, not the handler. `--json` prints the data; `--quiet` prints the identifier; neither is re-implemented per command, and no command can print prose into something being piped.

The plain rendering is a *function* when it is expensive: `--json` never calls it.

**Sensible defaults.** A handler that gives only data still reads well: a list of records becomes a table, one record becomes a field per line, a string is itself. And `--quiet` with nothing declared falls back to the `id`/`name`/`key` field, so the `create` command whose author forgot still prints the id rather than nothing.

**The exception.** `context.write(text)` goes straight to stdout, for the commands whose output *is* the payload - `completion bash`, `docs`. It opts out of all three readings, which is right roughly twice per program and wrong everywhere else.

## Failure

Errors carry their own exit code, so the entry point has no `instanceof` ladder:

| error | kind | exit |
|---|---|---|
| `ArgumentError` | the person typed something wrong | 2 |
| `ConfigurationError` | the machine is not set up | 3 |
| `AuthorizationError` | set up, but not allowed | 3 |
| `UnavailableError` | something upstream did not answer | 4 |
| `FacioError("conflict")` | understood and refused | 1 |
| anything else | | 1 |

Scripts switch on these, so they are part of your surface. Add your own by extending `FacioError` with one of the kinds.

`Program.run` returns an exit code for a run that finished and *throws* for one that did not: turning a failure into a code, printing the sentence and redacting what must not be printed are `runEntry`'s job, so a program that embeds `Program` directly has to catch and call `exitCodeFor` itself.

```ts
await runEntry(program, process.argv.slice(2), {
  // Every secret this installation knows, so none of them reaches a terminal.
  secrets: () => [credentials.token, ...Object.values(targets).map((one) => one.token)],
});
```

Redaction happens at the last edge rather than at each place a message is built, because those messages are written by people thinking about something else. Set `SOFTCLI_TRACE` to see a stack for an *unexpected* error; expected ones print one sentence, because a stack trace for "the note does not exist" is noise.
