# Completion

```sh
notes completion bash > /etc/bash_completion.d/notes
notes completion zsh  > ~/.zfunc/_notes
notes completion fish > ~/.config/fish/completions/notes.fish
```

The generated script is four lines and does one thing: hand the words to the program and print what comes back.

```bash
_notes_complete() {
  local IFS=$'\n'
  COMPREPLY=( $(notes __complete -- "${COMP_WORDS[@]:1:COMP_CWORD-1}" "${COMP_WORDS[COMP_CWORD]}") )
}
complete -o default -F _notes_complete notes
```

That is deliberate. A static script can only list what the author typed - the flag names - and the thing anybody actually wants completed is *the ids on this server* and *the profiles in this config*. Only the running program knows those. It also means fixing completion never means telling anyone to re-source anything.

## What completes

- the next word of any command whose prefix has been typed
- option names for the matched command, plus the globals
- enum values, from `coerce.oneOf` - no extra declaration
- anything a `complete` source returns, on an option or a `:slot`

```ts
arguments: { id: { complete: () => readNotes(storePath()).map((note) => note.id) } }
```

A source may be an array or a function, sync or async, and receives the words typed so far. It runs *before* any command does, so it cannot use capabilities - read what you need directly, and keep it fast.

Failures are swallowed: a completion that throws would print a stack trace into somebody's prompt.
