---
title: A model call names the app that makes it
domain: agent
status: active
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires:
  - plans/cli/20261110-0407-papo-becomes-copapo/plan.md
refs:
  - git://b83e428 - the last commit that holds the brief `briefs/model-calls-name-the-app.md`, which this plan covers; its facts were checked at git://ee48196
  - "[code://packages/model-openai-compat/src/index.ts#L27-L50](../../../../packages/model-openai-compat/src/index.ts#L27-L50) - `baseHeaders` and `headersFor`, which every request takes its headers from"
  - "[code://packages/model-openai-compat/src/types/options.ts#L3-L17](../../../../packages/model-openai-compat/src/types/options.ts#L3-L17) - `OpenAICompatProviderOptions`"
  - "[code://packages/model-openai-compat/src/config.ts#L19-L30](../../../../packages/model-openai-compat/src/config.ts#L19-L30) - `providersOf`"
  - "[code://packages/model-openai-compat/src/index.test.ts#L57-L104](../../../../packages/model-openai-compat/src/index.test.ts#L57-L104) - the header tests"
  - "[code://packages/copapo/src/commands.ts#L134](../../../../packages/copapo/src/commands.ts#L134) - where copapo builds its providers"
  - https://openrouter.ai/docs/app-attribution - `HTTP-Referer` and `X-OpenRouter-Title`, read 2026-11-09
---

## Goal

Every model call from cofold says which app makes it, so that OpenRouter attributes the usage to that app.
The app is `cofold` by default, and a program names itself.

## Reconnaissance

### Searches performed

- `rg -n -i "user-agent|x-title|http-referer" packages` - only the DuckDuckGo search sets a User-Agent; the model adapter sets none.
- `rg -n "openaiCompatProvider|providersOf" packages ../ahpd/packages/agent-cofold/src` - copapo calls `providersOf`; agent-cofold calls `openaiCompatProvider`.

### Runtime path

```
program -> providersOf(configs, { app }) -> openaiCompatProvider({ ..., app }) -> headersFor() -> fetch
```

### Gaps

- No request names its app; Node sends `User-Agent: node`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Model calls send User-Agent, `HTTP-Referer` and `X-OpenRouter-Title` | Softov, 2026-11-09: "open router headers referer and title are good" | 01 |
| The title is the app's name | Softov, 2026-11-09: "title is the app name" | 01 |
| The URL is `https://github.com/softov/cofold` for cofold and copapo, `https://ahpio.com` for ahpd | Softov, 2026-11-09, asked which URL: "github.com/softov/cofold"; "ahpio.com for ahpd" | 01, 02 |
| `HTTP-Referer` and `X-OpenRouter-Title` go only to a base URL on `openrouter.ai` | Softov, 2026-11-09, asked which providers: "Only openrouter.ai" | 01 |
| The web tools do not change | Softov, 2026-11-09: "web tools does not need" | - |
| The default is `cofold`, copapo names itself `copapo`, ahpd names itself `ahpd` | Softov, 2026-11-09: "default to cofold. when in copapo default to copapo. and when in ahpd default to ahpd" | 01, 02 |
| A provider's own `headers` win over the three, compared without case | (defaulted: the config file stays the person's override) | 01 |
| A base URL is on `openrouter.ai` when its host is `openrouter.ai` or ends with `.openrouter.ai` | (defaulted: the one exact test of a host) | 01 |
| The adapter's version is a `VERSION` constant, and a test checks it against `package.json` | (defaulted: copapo keeps its version as a constant; the test stops drift) | 01 |
| Only `X-OpenRouter-Title` is sent, not the old `X-Title` | (defaulted: OpenRouter names `X-Title` as the old name) | 01 |
| ahpd passes its name in its own plan, after a cofold release | the brief's *Who writes* | - |

## Proposed architecture

- **Data flow** - `OpenAICompatProviderOptions.app` is `{ name, version, url }`. With none, it is `{ name: 'cofold', version: VERSION, url: 'https://github.com/softov/cofold' }`. `baseHeaders` starts with `user-agent: <name>/<version>`, and on an OpenRouter host also `http-referer` and `x-openrouter-title`. The provider's `headers` go on top.
- **Layer responsibilities** - model-openai-compat: the headers. copapo: its own name. agents: unchanged.
- **Source-of-truth files** - [`code://packages/model-openai-compat/src/index.ts`](../../../../packages/model-openai-compat/src/index.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The adapter sends the app's name](task-01-the-adapter-sends-the-apps-name.md) | implemented | - |
| [02 - copapo names itself](task-02-copapo-names-itself.md) | implemented | 01 |

## Risks and tradeoffs

- A `VERSION` constant can drift from `package.json` - the test of task 01 fails when it does.

## Resume state

- **Done so far:** the plan, 2026-11-10. Tasks 01 and 02 implemented on 2026-11-10, not committed.
- **Next action:** Softov reviews tasks 01 and 02 and sets them to done. ahpd passes `{ name: 'ahpd', url: 'https://ahpio.com' }` in its own plan after a cofold release.
- **Watch out for:** the existing tests compare whole header objects; they gain `user-agent`.

## Final verification checklist

- [x] A request to `https://openrouter.ai/api/v1` carries all three headers; a request to `http://localhost:1234/v1` carries only User-Agent.
- [ ] `pnpm typecheck` and `pnpm test` are green.
