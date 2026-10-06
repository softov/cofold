---
title: A run answers its own pause - deferred
date: 2026-10-06
---

One thing waits: ahpd's work, in another repository.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd drops `pauses.ts`'s `owePause`, `payPause`, `rejoin` and `route`, and `runs.ts`'s pause bookkeeping and synthesized `run.finished` (task 06) | it is ahpd work, and it needs a cofold release carrying this plan; cofold changes nothing here | an ahpd plan, opened after that release |
