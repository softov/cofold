---
title: A steer carries image and text parts, not only a string - deferred
date: 2026-10-07
---

One thing waits: papo's side of a steer that carries parts.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| papo's `Chat.say` and `Chat.queue` taking parts, so a `Queued` steer kept across a decision (`steerHeld`) carries them into the resumed turn | nothing sends parts through papo today: the terminal composer types text, and ahpd steers through `@cofold/agents` directly. Softov, 2026-10-07: "change papo latter and sent nothing now.. so in a future could send attachments or others things." | a later papo plan, when a front has attachments to send |
