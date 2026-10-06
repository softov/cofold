---
title: A command typed without its required argument says which argument it needs
domain: commands
status: active
priority: medium
created: 2026-09-29
revalidated: 2026-09-29
refs:
  - "[code://packages/terminal/src/program.ts#L129-L142](../../../../packages/terminal/src/program.ts#L129-L142) - a parse with no command, reported as `unknown command` with a suggestion"
  - "[code://packages/terminal/src/parse.ts](../../../../packages/terminal/src/parse.ts) - where the typed words are matched against each pattern"
  - "file:///github/ahpd/.project/plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md - the consumer: `ahpd plugin install` with no name"
---

## Goal

When the words typed are exactly the literal words of a command whose pattern needs an argument that was not given, the program says that command needs that argument and shows its usage, exits 2, and never says `unknown command`.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
ahpd plugin install -> no pattern matches ['plugin', 'install', ':name...'] -> invocation.command null
  -> 'ahpd: unknown command "plugin install". Did you mean "plugin install"? Try ahpd --help'
```

### Gaps

- A command missing its required positional reads as an unknown command, and the suggestion is the command itself.

## Decisions locked in

No decision records of its own; the choices below are scope.

| What | Source | Task |
| --- | --- | --- |
| Fixed in `@cofold/terminal` for every program, not in ahpd | Softov, 2026-09-29, asked "How should ahpd upgrade plugins, so a 0.7 to 0.8 upgrade works?", chosen option: "`plugin install` stays as it is, apart from the two message fixes"; (defaulted: the fix lives where the message is made) | 01 |

## Proposed architecture

- **Data flow** - with no command matched, the terminal looks for a visible command whose literal prefix equals the typed words; when one exists, it names the first missing required slot from that command's pattern and prints the command's usage line.
- **Layer responsibilities** - terminal only.
- **Source-of-truth files** - [`code://packages/terminal/src/program.ts`](../../../../packages/terminal/src/program.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The missing argument is named](task-01-the-missing-argument-is-named.md) | implemented | - |

## Risks and tradeoffs

- Two commands with the same literal prefix and different slots: the message names the first command's slot; a test pins which.

## Resume state

- **Done so far:** task 01 implemented on 2026-10-06, awaiting Softov's review; nothing committed.
- **Next action:** Softov reviews; then a `@cofold/terminal` release, which Softov validates before the tag.
- **Open questions:** none.
- **Watch out for:** the `Did you mean` for a real typo must stay as it is.

## Final verification checklist

- [ ] `<program> plugin install` with no name: names `name`, shows the usage, exit 2.
- [ ] A typo still gets `unknown command` with its suggestion.
- [ ] The repository's typecheck and tests.
