---
title: A cut turn says why it was cut - deferred
date: 2026-10-15
---

These wait because no caller asks for them yet.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Crash recovery in `resume.ts` keeps its fixed texts | It runs with no abort and no caller, so the option does not reach it | unplanned |
| ahpd reads the reason in its transcripts | ahpd's agent-cofold takes `@cofold/agents` `^0.2.1`, which excludes 0.3 and 0.4 | an ahpd plan that moves agent-cofold to agents 0.4 |
