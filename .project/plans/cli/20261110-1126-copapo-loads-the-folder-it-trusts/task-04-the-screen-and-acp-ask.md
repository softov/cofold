---
title: The screen and ACP ask before they load a folder
status: implemented
depends: [task-03-trust-decides-what-loads.md]
layer: "copapo screen, copapo acp"
refs:
  - "[code://packages/copapo/src/screen/tui.ts#L14](../../../../packages/copapo/src/screen/tui.ts#L14) - `openScreen`, which asks before it mounts the catalogue"
  - "[code://packages/copapo/src/acp/server.ts#L73](../../../../packages/copapo/src/acp/server.ts#L73) - `chatOf(cwd)`, which asks before it builds a folder's service"
  - "[code://packages/copapo/src/acp/server.ts#L202](../../../../packages/copapo/src/acp/server.ts#L202) - the form request this task reuses"
  - npm://@textui/widgets@^0.9.1 - `confirm`
---

## Objective

On the screen, a folder that is not asked yet shows "Trust this folder?" before the catalogue, with the gated files it holds.
Over ACP, the first session in such a folder sends the same question as a form, when the client takes forms.
`/trust` asks again on the screen.

## Files

- `UPDATE: packages/copapo/src/screen/tui.ts:14` - `openScreen` takes a function that opens copapo for an answer, and asks first when trust is `unasked`.
- `UPDATE: packages/copapo/src/screen/app.tsx` - the question with `confirm`: title "Trust this folder?", the folder, the gated files, "Trust" and "Don't trust"; a `/trust` command in the *Screen* section.
- `UPDATE: packages/copapo/src/commands.ts` - the `chat` action passes `open` to `openScreen`.
- `UPDATE: packages/copapo/src/acp/server.ts:73` - `chatOf` becomes async: it asks with a form when trust is `unasked` and the client declared `elicitation.form`.
- `UPDATE: packages/copapo/src/screen/screen.test.ts` - the question shows, a yes saves and opens the catalogue, at 100x30 and 60x24.
- `UPDATE: packages/copapo/src/acp/server.test.ts` - a form is sent once per folder; accept saves yes; decline saves no; a client without forms gets no form.

## Steps

1. In `openScreen`, read `copapo.trust`, and when it is `unasked`, show the question before `registerCopapo` mounts.
2. On "Trust", call `saveTrust` with `true`, open copapo again, and mount with the new service.
3. On "Don't trust", call `saveTrust` with `false` and mount with the service already built.
4. On Escape, save nothing and mount with the service already built.
5. Add `/trust`, which asks the same question and says that the answer applies at the next start.
6. In the ACP server, ask once per folder, and hold other sessions for that folder until the answer comes.
7. Send one form field, a boolean `trust`, with a message that names the folder and its gated files.
8. Save `true` on accept with `trust` true, `false` on accept with false or on decline, and nothing on cancel.

## Validation

- `packages/copapo/src/screen/screen.test.ts`: the question at two sizes, each answer, and Escape.
- `packages/copapo/src/acp/server.test.ts`: the form cases, and that every frame still passes the contract test.
- `pnpm --filter @cofold/copapo typecheck` passes.
- By hand: `copapo` in a folder with `.copapo.json`, answer each way, start again.

## Resume

Implemented 2026-11-10. The question is `askTrust` in `screen/trust.ts`, on `ConfirmDialog` through `app.layers`, so Escape differs from "Don't trust". The paper theme draws no dialog title, so the question is in the message. Over ACP the form is tied to the request by `requestId`, since no session exists yet; `RequestHandler` now gets the request id. Found by a run in a pseudo-terminal: `main.ts` dropped `reopen`; fixed.
