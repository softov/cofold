# Capabilities

Every hand-written CLI grows this field:

```ts
needs: "nothing" | "config" | "server"
```

and an `if` ladder in the runner that turns it into state. The list is closed, the resolution is positional, and adding a fourth thing means editing the runner. This is the generalisation.

```ts
const kernel = createKernel()
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
kernel.command({
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

**Checked at startup.** `kernel.verify()`, which `Program.run` calls, refuses a command that needs an unregistered capability, a capability that depends on one, and a cycle - naming the path that closed it.

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

A command may declare what it requires, and a capability may declare what it requires; the kernel's `authorize` hook sees both, plus the resolved capabilities:

```ts
createKernel({
  authorize: ({ command, scopes, capabilities }) => {
    const held = (capabilities["credentials"] as Credentials).scopes;
    const missing = scopes.filter((scope) => !held.includes(scope));
    if (missing.length > 0) throw new AuthorizationError(`${command.id} needs ${missing.join(", ")}`, missing);
  },
})
```

Without an `authorize` hook, a command that declares `scopes` is refused rather than quietly allowed. A program that checks nothing should not be able to *look* as though it checks something.
