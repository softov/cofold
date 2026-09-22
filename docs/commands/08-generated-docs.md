# Generated documentation

```ts
import { reference, agentSkill } from "@cofold/commands/docs";

reference(registry, { name: "notes", version, description, globals: globalOptions });
agentSkill(registry, { name: "notes", description: "Read and write the notes on this machine." });
```

Both are markdown, both are generated from the registry, and both are usually wired up as commands - `notes docs`, `notes skill` - so a build step can write them to a file and CI can fail when the checked-in copy differs.

## Two readings, and the difference is the point

**The reference** is for a person and lists everything: usage, argument tables, option tables with defaults, environment variables and enum values, what each command needs, and examples.

**The skill** is for whatever is driving the program, and lists only what an agent can act on. Nobody's model needs the command that rotates a token or edits the local configuration; printing those to something that cannot usefully run them is an invitation rather than a reference.

That filter is what `groups` is for:

```ts
createRegistry({
  groups: [
    { name: "work",  title: "Cases and reports", agent: true },
    { name: "tokens", title: "Access tokens",    agent: false },
    { name: "setup",  title: "Setup and diagnosis", agent: false },
  ],
})
```

With `groups` declared, `group` becomes mandatory on every command - checked at registration. That is deliberate: a command added without a group would otherwise be quietly absent from the document every agent reads, which is the failure nobody notices until somebody asks why the agent never uses the new command.
