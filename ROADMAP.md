# Roadmap and open questions

What is built works: `npm run check` is green, and the five example programs run end to end. What follows is honest about the rest.

## Not built yet

- **Targets, on top of the configuration.** One program pointed at staging, production or a colleague's box, selected by a global so the capability graph resolves *after* the selection. The half underneath this is now built: [`cofold/config`](src/config) resolves `--config` over `$APP_CONFIG` over a project file over `$XDG_CONFIG_HOME`, each layer merging rather than replacing, and says which file a value came from. It is a provider a program drops into `createRegistry()` rather than a package, because finding a file is not worth one - and it takes the parser rather than shipping one, which is what keeps the dependency count at zero. Targets are the same shape and are the part still missing.

- **Authentication, as a capability.** Where a token lives and how it is found: a flag, the environment, an OS keychain, a config file, an interactive login, scoped per target so production credentials are never sent to staging. Two things to keep straight. Authorization is *already built* - commands and providers declare `scopes`, the registry takes an `authorize` hook, and a command's scopes are unioned with those of every capability it needs and checked before any `resolve` runs. This entry is only about authentication, which needs no new mechanism either: `needs: ["auth"]` is a capability like any other. The keychain is the part that cannot be portable, which is the argument for a separate package: the core has zero dependencies and runs unmodified on Node, Bun and Deno, and a native secret store is where that stops being free. Worth being deliberate about, because a wrong config file is inconvenient and a wrong credential store is dangerous.

- **A generated `doctor`.** The command that says why the tool is not working, without anybody reading the source: which config file was loaded, which target is selected, whether credentials were found and where, whether the server answers, whether the cached manifest is stale. Nearly free here, because `registry.providers` already enumerates every capability with its description and its dependencies. The one thing missing is an optional `check` on a provider, next to `resolve` and `dispose`, so a capability can say what "working" actually means for it; the default answer is whether `resolve` succeeded, with the error and how long it took. A command rather than a flag, so it goes through the output contract: `doctor --json` is what belongs in a support ticket. Note that it resolves every capability by design, which is the one case where the eager resolution below is the point rather than the problem.

- **Renaming the built-in commands.** `builtins` is a boolean and the patterns are fixed, so a program can have `completion` or nothing, and would inherit the same for `doctor`. It should be a map: keep the built-in but call it `check`, or `verify`, or nothing at all. Small, and better decided before a second built-in exists than after.

- **An `object` field at a terminal.** `{ type: object, properties: { ... } }` is validated over HTTP and MCP, because those send objects, and cannot be typed at a command line at all: a schema of `type: object` has no text reading, so the string that arrived is refused by `check`. `coerce.json` is the shape of the answer - a coercer whose schema describes what *arrives* rather than what it becomes - but as something a field can ask for rather than only the raw form. Worth doing now that a document can write `{theme.mode}` and reach into one.

- **Extended MCP capabilities.** `cofold/mcp/stdio` serves tools over stdio with no dependencies, and `cofold/mcp/server` adds stateless Streamable HTTP through the official SDK, declared as an optional peer. Both carry explicit tool contracts, trusted request context, and progress and cancellation. Resources and prompts exist on the SDK path only and have no consumer yet, so treat them as provisional. Stateful sessions, resumability, subscriptions, completion, sampling and elicitation are not implemented and are not advertised. See `docs/07-mcp.md`.

- **Interactive prompts.** A missing required option could ask, when stdin is a TTY and `--no-input` was not given. Needs care: it must never trigger in a script.

- **`--help` for a specific option**, pagination for long help, and terminal width awareness. All small.

- **Command aliases**, and a deprecation path (`deprecated: "use X"` that warns on stderr and hides from help).

- **i18n.** Not planned. Say so rather than half-doing it.

## Open questions

**Can a document name a third-party executor?** `s2cmd` shipped as [a package of its own](https://github.com/softov/s2cmd) with four executors it defines itself - `noop`, `internal`, `exec` and `http` - and an unknown name is a registration error. Letting a program add one is easy; deciding what a document is then allowed to name is not, and the answer has to hold for a document somebody else wrote. Until it is answered, the closed set is the safe default rather than an oversight.

**How much should `run` be allowed to do?** Today it returns one `Output`. Long-running commands want progress, and streaming commands want to yield rows. An async iterator return would cover both - `--json` becomes JSON Lines - but it doubles the contract every surface has to honour.

**Should there be lifecycle hooks?** The case against: hooks are action at a distance, and reading a command tells you nothing about what runs around it. Capabilities already cover what a `prerun` and `postrun` are used for, with `resolve` and `dispose`, and the difference is that the command declares them in `needs`, so the wiring is visible where it is used. The one hook with no equivalent is "command not found", which is really the plugin-loading question below wearing a different hat.

**Answered: HTTP is a surface, and every surface is fed from one declaration.** `registry.action` takes `input` as a map of JSON Schema and `surfaces` where presence is the switch, so the terminal, the MCP tool and an HTTP request are three readings of one statement rather than three statements that have to be kept in agreement. The binding lives at `surfaces.http`, a key `cofold/remote` adds to `Surfaces` by declaration merging: typed where it is written, unknown to the core. `SurfaceFlags` gained `remote`, because publishing used to be decided by `surfaceEnabled(command, "docs")` - hiding a command from the reference withdrew it from the network. What a request carries is derived by `placementOf` rather than restated: the path takes what it names, and the rest is query for a method without a body and body for one with it, with `query` and `body` left as overrides. Still open is whether a `serve` entry point should render the registry as an HTTP API directly, rather than only describing one, and whether `command` should keep its own vocabulary now that `action` is the way in.

**Trust for remote surfaces.** Today the client decides the transport, which is the important half. Not yet done: pinning a manifest per target so a changed surface is *noticed*, and a signature so it can be verified. Worth doing before anything points at a host somebody else controls.

**Should capabilities be lazy?** They resolve eagerly in declaration order. A command that needs `database` but exits early on a bad argument still opened the database. A lazy proxy would fix it and would make the failure order harder to predict, which is the thing this design deliberately made predictable.

**Plugin loading.** Loading commands from installed packages is nearly free, since commands are data - but "nearly free to load" and "safe to load" are different questions, and the second one has not been answered.
