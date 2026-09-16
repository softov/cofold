---
title: Harness core - deferred
date: 2026-09-16
---

Named out of scope so nobody smuggles them in; each gets its own plan in its domain.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| code mode (`run_code`, generated `.d.ts`, isolate) | scope | agent domain, unplanned |
| guardrail package | scope | agent domain, unplanned |
| `agentAsTool`, `createNetwork` | scope | network domain, unplanned |
| memory hooks | scope | memory domain, unplanned |
| SQLite and Durable Object stores | pluggable behind `Store`; the file store shipped first | store domain, unplanned |
| JSON-RPC / WS / HTTP / MCP-server transports | scope | transport domain, unplanned |
| `fromFacioAction()` | scope | commands domain, unplanned |
| parallel tool execution | scope | agent domain, unplanned |
| session fork / rewind | contract slots only in p3 | agent domain, unplanned |
| p4, the ahpd adapter | the first human consumer is papo instead | transport domain, when wanted |
