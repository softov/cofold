# Roadmap and open questions

What is built works: `npm run check` is green, and the five example programs run end to end. What follows is honest about the rest.

## Not built yet

- **Targets, on top of the configuration.** One program pointed at staging, production or a colleague's box, selected by a global so the capability graph resolves *after* the selection. The half underneath this is now built: [`softcli/config`](src/config) resolves `--config` over `$APP_CONFIG` over a project file over `$XDG_CONFIG_HOME`, each layer merging rather than replacing, and says which file a value came from. It is a provider a program drops into `createRegistry()` rather than a package, because finding a file is not worth one - and it takes the parser rather than shipping one, which is what keeps the dependency count at zero. Targets are the same shape and are the part still missing.

- **Authentication, as a capability.** Where a token lives and how it is found: a flag, the environment, an OS keychain, a config file, an interactive login, scoped per target so production credentials are never sent to staging. Two things to keep straight. Authorization is *already built* - commands and providers declare `scopes`, the registry takes an `authorize` hook, and a command's scopes are unioned with those of every capability it needs and checked before any `resolve` runs. This entry is only about authentication, which needs no new mechanism either: `needs: ["auth"]` is a capability like any other. The keychain is the part that cannot be portable, which is the argument for a separate package: the core has zero dependencies and runs unmodified on Node, Bun and Deno, and a native secret store is where that stops being free. Worth being deliberate about, because a wrong config file is inconvenient and a wrong credential store is dangerous.

- **A generated `doctor`.** The command that says why the tool is not working, without anybody reading the source: which config file was loaded, which target is selected, whether credentials were found and where, whether the server answers, whether the cached manifest is stale. Nearly free here, because `registry.providers` already enumerates every capability with its description and its dependencies. The one thing missing is an optional `check` on a provider, next to `resolve` and `dispose`, so a capability can say what "working" actually means for it; the default answer is whether `resolve` succeeded, with the error and how long it took. A command rather than a flag, so it goes through the output contract: `doctor --json` is what belongs in a support ticket. Note that it resolves every capability by design, which is the one case where the eager resolution below is the point rather than the problem.

- **Renaming the built-in commands.** `builtins` is a boolean and the patterns are fixed, so a program can have `completion` or nothing, and would inherit the same for `doctor`. It should be a map: keep the built-in but call it `check`, or `verify`, or nothing at all. Small, and better decided before a second built-in exists than after.

- **Extracting `s2cli` into a package.** The front end itself is built, as [`examples/s2cli`](examples/s2cli): a YAML or JSON document becomes actions, and gets validation, help, completion, `--json`, a generated reference, HTTP routes and MCP tools without anybody writing a handler. It stays an example until the executor interface has stopped moving, the way `open-cli` proves the OpenAPI seam without being a package. What would have to be decided first: whether third-party executors can be registered, and what a document is allowed to name if they can.

- **An `object` field at a terminal.** `{ type: object, properties: { ... } }` is validated over HTTP and MCP, because those send objects, and cannot be typed at a command line at all: a schema of `type: object` has no text reading, so the string that arrived is refused by `check`. `coerce.json` is the shape of the answer - a coercer whose schema describes what *arrives* rather than what it becomes - but as something a field can ask for rather than only the raw form. Worth doing now that a document can write `{theme.mode}` and reach into one.

- **A `serve` for MCP.** `softcli/mcp` stops at descriptors; a program still writes the six lines that hand them to an SDK. Deliberate for now, so nothing depends on an SDK version.

- **Interactive prompts.** A missing required option could ask, when stdin is a TTY and `--no-input` was not given. Needs care: it must never trigger in a script.

- **`--help` for a specific option**, pagination for long help, and terminal width awareness. All small.

- **Command aliases**, and a deprecation path (`deprecated: "use X"` that warns on stderr and hides from help).

- **i18n.** Not planned. Say so rather than half-doing it.

## s2cli, in more detail

Everything a document-defined command needs already exists except one thing: `run`. Today `run` is a function, and remote commands get around it with one generic handler plus a `transport` capability. A document has to state execution as data, which means named executors and a step list:

```yaml
name: myapp
version: 1.0.0

commands:
  deploy:
    summary: Deploy the application
    input:
      env:    { type: string, enum: [staging, production], default: production, cli: { short: -e } }
      force:  { type: boolean, default: false, cli: { short: -f } }
    surfaces:
      cli: { pattern: [deploy] }
    run:
      - exec:
          command: ./scripts/build.sh
          args: ["{env}"]
      - exec:
          command: ./scripts/deploy.sh
          args:
            - "{env}"
            - { when: force, value: "--force" }
      - rest:
          method: POST
          endpoint: "{$config.hooks.deployed}"
```

`run` is a list, because a command is usually a batch. Its arguments belong to the step rather than the command, since each step has its own. A single step may be written unwrapped. Steps run in order and stop at the first failure, and an unknown executor is a registration error rather than a runtime surprise.

The executors worth having: `exec` for a process, `rest` for an HTTP call, `internal` for another command in the same registry, and `noop` for a group that only exists to hold subcommands.

**Arguments are arrays, never a shell string,** unless the step says `shell: true`. Interpolating a value into a shell string is command injection the moment that value comes from anywhere but somebody's own keyboard.

**No template language.** `{{#if force}}--force{{/if}}` means a dependency and an argument list that gets re-parsed. Since the input is already validated and typed, conditionals and repetition can be data: `{ when: force, value: "--force" }`, `{ each: tag, value: "--tag={$item}" }`. Uglier for one case, inspectable for all of them, and `--help` can show what will actually run. Interpolation is one rule with no exception: `$` means "not an input field", so `{env}` and `{theme.mode}` are the input, and `{$env.NAME}`, `{$config.theme.mode}` and `{$item}` are not.

**A shell step must not become an agent tool by accident.** If MCP comes for free then a YAML file becomes a set of tools an agent can call, and `exec` is arbitrary shell: a remote code execution surface handed over by a config file. `mcp` being opt-in already prevents the worst of it, but this front end should go further and refuse to publish an `exec` step as an MCP tool or an HTTP route without an explicit per-command opt-in that is separate from `surfaces`. `rest` and `internal` steps can default the normal way.

Two conveniences worth taking: `env:` to load environment files, and `imports:` to compose several documents, with the ordering rule stated (later wins) and `optional: true` for a file that may not be there.

## Open questions

**How much should `run` be allowed to do?** Today it returns one `Output`. Long-running commands want progress, and streaming commands want to yield rows. An async iterator return would cover both - `--json` becomes JSON Lines - but it doubles the contract every surface has to honour.

**Should there be lifecycle hooks?** The case against: hooks are action at a distance, and reading a command tells you nothing about what runs around it. Capabilities already cover what a `prerun` and `postrun` are used for, with `resolve` and `dispose`, and the difference is that the command declares them in `needs`, so the wiring is visible where it is used. The one hook with no equivalent is "command not found", which is really the plugin-loading question below wearing a different hat.

**Answered: HTTP is a surface, and every surface is fed from one declaration.** `registry.action` takes `input` as a map of JSON Schema and `surfaces` where presence is the switch, so the terminal, the MCP tool and an HTTP request are three readings of one statement rather than three statements that have to be kept in agreement. The binding lives at `surfaces.http`, a key `softcli/remote` adds to `Surfaces` by declaration merging: typed where it is written, unknown to the core. `SurfaceFlags` gained `remote`, because publishing used to be decided by `surfaceEnabled(command, "docs")` - hiding a command from the reference withdrew it from the network. What a request carries is derived by `placementOf` rather than restated: the path takes what it names, and the rest is query for a method without a body and body for one with it, with `query` and `body` left as overrides. Still open is whether a `serve` entry point should render the registry as an HTTP API directly, rather than only describing one, and whether `command` should keep its own vocabulary now that `action` is the way in.

**Trust for remote surfaces.** Today the client decides the transport, which is the important half. Not yet done: pinning a manifest per target so a changed surface is *noticed*, and a signature so it can be verified. Worth doing before anything points at a host somebody else controls.

**Should capabilities be lazy?** They resolve eagerly in declaration order. A command that needs `database` but exits early on a bad argument still opened the database. A lazy proxy would fix it and would make the failure order harder to predict, which is the thing this design deliberately made predictable.

**Plugin loading.** Loading commands from installed packages is nearly free, since commands are data - but "nearly free to load" and "safe to load" are different questions, and the second one has not been answered.
