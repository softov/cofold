---
title: copapo serves ACP - deferred
date: 2026-11-10
---

What `copapo acp` does not serve yet, and the ahpd side.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The client's `mcpServers` | cofold has no MCP client | agent domain, unplanned |
| `additionalDirectories` | copapo runs a session in one workspace | unplanned |
| Images, audio and embedded resources in a prompt | `Chat.say` takes text | unplanned |
| `usage_update` on the claude backend | the CLI keeps its context count to itself | unplanned |
| A `copapo` row in ahpd's `knownAgents` and `presets` | ahpd takes it after a cofold release that publishes `@cofold/copapo` | an ahpd plan |
| agent-acp reading `available_commands_update` | ahpd does not read it today | an ahpd plan |
