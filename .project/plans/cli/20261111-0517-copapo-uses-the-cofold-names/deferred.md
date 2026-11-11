---
title: copapo uses the cofold names - deferred
date: 2026-11-11
---

These are ahpd's side of the change. They wait for a cofold release with the new names.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| agent-cofold resolves under `cofold` with `.cofold.json`, reads `COFOLD_CONFIG`, and reads `COFOLD_*` alone | it reads copapo's config as copapo does; copapo 0.1.0 still uses the old names | ahpd, `packages/agent-cofold/src/config.ts` |
| agent-cofold mounts the config at `cofold/config.json` and sets `COFOLD_CONFIG` | the machine's copapo reads the new names only after the release | ahpd, `packages/agent-cofold/src/agent.ts` |
| the copapo machine profile names `COFOLD_BASE_URL`, `COFOLD_API_KEY`, `COFOLD_MODEL` and `COFOLD_CONFIG` | the image pins copapo 0.1.0 | ahpd, `packages/sdk/src/machines/agents.ts` |
| the docs name the cofold files | they describe what agent-cofold reads | ahpd, `packages/agent-cofold/README.md`, `docs/plugins/COMPUTERS.md`, `docs/plugins/PLUGINS.md` |
