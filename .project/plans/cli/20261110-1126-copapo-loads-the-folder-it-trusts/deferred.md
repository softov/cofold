---
title: copapo loads the folder it trusts - deferred
date: 2026-11-10
---

These are ahpd's side of the change; cofold's side is built.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd's copapo preset sets `honoursTrust`, and its comment changes | copapo now asks before it loads a folder's own files, through an ACP form; the preset is ahpd's | ahpd, `packages/agent-acp/src/presets.ts` |
| ahpd's cofold plugin reads context files and gates project skills on its own `projectTrust` | ahpd's brief on agent settings lists `projectTrust` for cofold as not built; `readContextFiles` and `fileSkillSource({ project, walk })` are the library side | ahpd, `packages/agent-cofold` |
