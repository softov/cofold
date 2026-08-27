# Roadmap and open questions

What is built works: `pnpm build && pnpm test` is green, and the three
playground programs run end to end. What follows is honest about the rest.

## Not built yet

- **A `runtime` package.** Config files, profiles/targets, credential storage,
  keychain, `doctor`. Today every program writes its own providers for these -
  which is exactly the duplication this library exists to remove. It is the next
  package, and the one with the most reuse in it.
- **A `serve` for MCP.** `@softcli/mcp` stops at descriptors; a program still
  writes the six lines that hand them to an SDK. Deliberate for now, so nothing
  depends on an SDK version.
- **Interactive prompts.** A missing required option could ask, when stdin is a
  TTY and `--no-input` was not given. Needs care: it must never trigger in a
  script.
- **`--help` for a specific option**, pagination for long help, and terminal
  width awareness. All small.
- **Command aliases**, and a deprecation path (`deprecated: "use X"` that warns
  on stderr and hides from help).
- **i18n.** Not planned. Say so rather than half-doing it.

## Open questions

**How much should `run` be allowed to do?** Today it returns one `Output`.
Long-running commands want progress, and streaming commands want to yield rows.
An async iterator return would cover both - `--json` becomes JSON Lines - but it
doubles the contract every surface has to honour.

**Should the HTTP binding be first-class?** It lives in `meta.http` and only
`@softcli/remote` understands it. If a `serve` package ever renders a registry as
an HTTP API directly - the fourth surface - the binding stops being an extension
and becomes part of the declaration.

**Trust for remote surfaces.** Today the client decides the transport, which is
the important half. Not yet done: pinning a manifest per target so a changed
surface is *noticed*, and a signature so it can be verified. Worth doing before
anything points at a host somebody else controls.

**Should capabilities be lazy?** They resolve eagerly in declaration order. A
command that needs `database` but exits early on a bad argument still opened the
database. A lazy proxy would fix it and would make the failure order harder to
predict, which is the thing this design deliberately made predictable.

**Plugin loading.** `oclif` loads commands from installed packages. Since
commands are data, this is nearly free - but "nearly free to load" and "safe to
load" are different questions, and the second one has not been answered.
