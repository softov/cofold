# Compared with the alternatives

| | commander | yargs | oclif | clipanion | citty | cobra | **softcli** |
|---|---|---|---|---|---|---|---|
| Declaration survives the call | no | no | class | class | partly | yes | **yes** |
| Short flags, clusters, `--` | yes | yes | yes | yes | yes | yes | **yes** |
| Coercion + a schema for it | fn only | magic | fn only | fn only | fn only | typed | **both** |
| Dynamic shell completion | no | partial | yes | partial | no | yes | **yes** |
| Generated reference | no | no | yes | no | partial | yes | **yes** |
| Agent-facing skill | no | no | no | no | no | no | **yes** |
| MCP tools from the registry | no | no | no | no | no | n/a | **yes** |
| Capability lifecycle (`needs`) | hooks | middleware | class | class | no | no | **typed** |
| Output contract (`--json`/`--quiet`) | no | no | partial | no | no | no | **yes** |
| Exit-code taxonomy | no | no | partial | no | no | no | **yes** |
| Secret redaction at the edge | no | no | no | no | no | no | **yes** |
| Commands over the wire | no | no | plugins | no | no | no | **yes** |
| Runtime dependencies | 0 | many | many | 0 | 0 | n/a | **0** |

Where the alternatives are better, and it is worth saying:

- **commander** is ubiquitous, is on every machine already, and has fifteen years of edge cases in its test suite. For a script with four flags, use it.
- **yargs** has richer built-in coercion and a middleware ecosystem.
- **oclif** ships the release machinery too - `oclif pack`, autoupdate, plugin install. If you want that, you want oclif; it is not what this is.
- **clipanion**'s class-based commands give you better inference on positional arguments than a `:slot` string ever will.
- **cobra** is more mature at everything softcli tries to do. It is also Go.

Where this one is genuinely different: the declaration is *reusable data*, so a second and third consumer cost a hundred lines instead of a rewrite. If a CLI is the only surface you will ever want, that property is worth nothing and commander is the better choice.
