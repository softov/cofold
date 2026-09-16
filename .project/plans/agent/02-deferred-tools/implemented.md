---
title: Deferred tools - implemented
date: 2026-09-16
refs:
  - git://df5d5b8 - the commit
  - code://packages/agents/src/run/deferred.ts - requestToolsOf, instructionsOf, markLoaded, readLoaded, createLoadToolsTool
  - code://packages/agents/src/run/deferred.test.ts - 7 tests
---

A tool can be declared `deferred`: the model sees it in a `## tools` index of the prompt and asks for its definition with the core tool `load_tools`; what a session has loaded is remembered in `kv.agent` under `loaded-tools/<sessionId>`, so the request carries the non-deferred tools plus the loaded ones.

## What was built

- `Tool.deferred`, `Capability.defer: true | { over: N }`; the request computed per step in `run/turn.ts`; `resolveCapabilities` applies `defer` and the loaded set.

## Verified

- `run/deferred.test.ts`, 7 tests; `pnpm check` green.

## Departures from the plan

- none.

## Left for later

- none.
