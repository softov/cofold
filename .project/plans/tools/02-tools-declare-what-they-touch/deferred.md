---
title: Tools declare what they touch - deferred
date: 2026-10-06
---

One thing waits: ahpd's work, in another repository.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ahpd drops its tool-name tables - `agent-cofold/src/tools.ts`'s per-name subject fields at lines 176-224 (`toolMetaOf`, `intentionOf`, `toolInputOf`, `describe`) read `subject` off `tool.proposed` instead, `turnagent.ts`'s `EDITS` and `editPathOf` at lines 35-45 become `tool.writes(input)` kept only when it is inside the workspace, and `capabilities.ts`'s `withoutTaken` and `taken` at lines 84-117 become `Capability.exclude` (task 06) | it is ahpd work, and it needs a cofold release carrying this plan; cofold changes nothing here | an ahpd plan, opened after that release, naming this task and the cofold versions it needs |
