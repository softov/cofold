---
title: Permission modes and reasoning effort are library data - deferred
date: 2026-10-06
---

One thing waits: ahpd's work, in another repository.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd replaces its copies - `agent-cofold/src/agent.ts`'s `PERMISSION_MODES`, `PERMISSION_LABELS` and `PERMISSION_DESCRIPTIONS` at lines 124-144, its `EFFORT_LEVELS` and `effortOf` at 146-158, and the forced `features.reasoning` at 374 - and reads `turnagent.ts`'s `modeOf` from the harness (task 05) | it is ahpd work, and it needs a cofold release carrying this plan; cofold changes nothing here, and ahpd keeps its own labels | an ahpd plan, opened after that release, naming this task and the cofold versions it needs |
