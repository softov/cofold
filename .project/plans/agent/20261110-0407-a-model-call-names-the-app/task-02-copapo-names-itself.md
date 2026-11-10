---
title: copapo names itself
status: implemented
depends: [task-01-the-adapter-sends-the-apps-name.md]
layer: "copapo"
refs:
  - "[code://packages/copapo/src/commands.ts#L134](../../../../packages/copapo/src/commands.ts#L134) - `providersOf(config.providers)`"
  - "[code://packages/copapo/src/program.ts#L7](../../../../packages/copapo/src/program.ts#L7) - `VERSION`"
---

## Objective

copapo's model calls say `copapo/<version>`, and to OpenRouter they give `https://github.com/softov/cofold` and the title `copapo`.

## Files

- `UPDATE: packages/copapo/src/commands.ts` - `providersOf(config.providers, { app: COPAPO_APP })`.
- `UPDATE: packages/copapo/src/program.ts` - `COPAPO_APP` next to `VERSION`.
- `UPDATE: packages/copapo/README.md` - one line on the headers copapo sends, under *Configuration*.

## Steps

1. Declare `COPAPO_APP` as `{ name: 'copapo', version: VERSION, url: 'https://github.com/softov/cofold' }` in `program.ts`.
2. Pass it to `providersOf` in `openCopapo`.
3. Say in the README that a provider's `headers` replace these.

## Validation

- `commands.test.ts`: a scripted fetch on an OpenRouter base URL sees `user-agent: copapo/0.0.1` and `x-openrouter-title: copapo`.
- `pnpm --filter @cofold/copapo test` is green.

## Resume
Implemented 2026-11-10. Departure: `VERSION`, `COPAPO_APP` and `providersFor` are in a new `src/app.ts`, not in `program.ts`.
`program.ts` imports `commands.ts`, so a constant there that `commands.ts` reads would make an import cycle.
`app.test.ts` checks the headers on an OpenRouter and a local provider, and `VERSION` against `package.json`.
