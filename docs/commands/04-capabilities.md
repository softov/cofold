# Capabilities

Every hand-written CLI grows this field:

```ts
needs: "nothing" | "config" | "server"
```

and an `if` ladder in the runner that turns it into state. The list is closed, the resolution is positional, and adding a fourth thing means editing the runner. This is the generalisation.

```ts
const registry = createRegistry()
  .provide("config", {
    description: "The configuration file",
    resolve: () => loadConfig(),
  })
  .provide("credentials", {
    deps: ["config"],
    resolve: ({ config }) => loadCredentials(config.paths),
  })
  .provide("server", {
    deps: ["config", "credentials"],
    resolve: ({ config, credentials }) => new Client(config.url, credentials.token),
    dispose: (client) => client.close(),
  });
```

A command then declares what it wants, and **its handler is typed to exactly that**:

```ts
registry.command({
  id: "case.show",
  pattern: ["case", "show", ":id"],
  summary: "Show one case",
  needs: ["server"],
  run: (context) => output(context.server.get(`/cases/${context.value("id")}`)),
  //                        ^^^^^^^^^^^^^^ typed. `context.database` is a compile error.
});
```

## What you get

**Resolution before entry.** A handler runs only once everything it declared is resolved. A command that needs a server fails on the missing configuration *before* it starts, rather than halfway through its own work - and handlers stay three lines long because none of that is in them.

**Resolved once.** Two capabilities that both depend on `config` share one `config`. The order is a depth-first walk of the dependency graph, computed per invocation.

**Disposed in reverse.** `dispose` runs after the handler whether it returned or threw, innermost first. If a *later* capability throws during resolution, the ones already opened are still disposed. This is where a store flushes, a connection closes, a lock is released - and no command has to remember.

**Checked at startup.** `registry.verify()`, which `Program.run` calls, refuses a command that needs an unregistered capability, a capability that depends on one, and a cycle - naming the path that closed it.

**Reserved names.** A capability cannot be called `input`, `command`, `out`, or anything else the context already has. Refused at `provide()`, not discovered when a command mysteriously stops working.

## Reading the globals

Capabilities are resolved with the context, whose `globals` holds the program-wide options - `--config`, `--url`, `--profile`, `--verbose`:

```ts
.provide("config", {
  resolve: (_deps, context) => loadConfig({
    path: context.globals["config"] as string | undefined,
  }),
})
```

Globals are deliberately *not* in `context.input`: an MCP call has no `--config`, and mixing them in would put fields into every generated schema that only one surface can produce.

## Scopes

A command and each of its transitive capabilities may declare scopes. The registry calls `authorize` before resolving capabilities. The actor must come from trusted request context or an application closure:

```ts
createRegistry({
  authorize: ({ command, scopes, context }) => {
    const actor = context.request?.actor as { scopes: string[] } | undefined;
    const missing = scopes.filter((scope) => !actor?.scopes.includes(scope));
    if (missing.length > 0) throw new AuthorizationError(`${command.id} needs ${missing.join(", ")}`, missing);
  },
});
```

`registry.scopesFor(command)` computes the same union without opening anything, for discovery filters. Without an authorizer, any required scope is refused, including capability-only scopes.

The former `authorize.capabilities` field is deprecated and always empty. Move credential lookup needed for authorization to trusted adapter context or a closure. Protected capability resolution must not happen before permission is checked.

Adapters can pass `request` and `signal` through `registry.execute`. `request` is a reserved context name and must never be populated from ordinary action arguments. Cancellation is cooperative. Every disposer is attempted even if another fails; disposal errors are aggregated. MCP server execution routes cleanup errors after successful handlers to its diagnostic observer so they do not make completed mutations look retryable.
