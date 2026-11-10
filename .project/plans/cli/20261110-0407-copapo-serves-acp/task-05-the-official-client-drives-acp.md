---
title: The official client drives copapo acp
status: implemented
depends: [task-04-load-resume-fork-modes.md]
layer: "copapo"
refs:
  - npm://@agentclientprotocol/sdk@^1.8.0 - `ClientSideConnection` and `ndJsonStream`
  - "[code://packages/copapo/README.md](../../../../packages/copapo/README.md) - where the ACP section goes"
---

## Objective

A test drives `copapo acp` with `@agentclientprotocol/sdk`'s client, and the README says how to run copapo from an ACP client.

## Files

- `UPDATE: packages/copapo/package.json` - `@agentclientprotocol/sdk` in `devDependencies`.
- `CREATE: packages/copapo/src/acp/contract.test.ts` - `ClientSideConnection` over a pair of streams to `serveAcp`.
- `UPDATE: packages/copapo/README.md` - an *ACP* section: the command, what it serves, what it ignores.
- `UPDATE: packages/copapo/src/commands.ts` - the `acp` command's description and example.

## Steps

1. Add the SDK as a devDependency of copapo only.
2. Connect `ClientSideConnection` to `serveAcp` over two in-memory streams.
3. Run `initialize`, `session/new`, a prompt with a permission and a question, a cancel, a steer, a fork and a load.
4. Check every update and answer with the SDK's own validation.
5. Write the README section with the methods served, `mcpServers` ignored and the tools run by copapo.

## Validation

- `contract.test.ts` is green through the SDK's validation.
- `npm pack --dry-run` in `packages/copapo` lists no test file, and `dependencies` has no ACP package.
- By hand: ahpd runs `copapo acp` as a custom ACP agent and finishes one turn.

## Resume
Implemented 2026-11-10. pnpm resolved `@agentclientprotocol/sdk` 1.9.0 under the range `^1.8.0`.
`contract.test.ts` runs the whole session through `ClientSideConnection`, and checks every frame copapo writes with the SDK's zod schemas.
`npm pack --dry-run` lists no test file, and `dependencies` names no ACP package.
Left for Softov: the run by hand from ahpd.
