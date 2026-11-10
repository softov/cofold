---
title: A model call names the app that makes it
created: 2026-11-09
refs:
  - git://ee48196 - cofold main, where the facts were checked
  - git://cb74ca9c2 - ahpd main, where the ahpd facts were checked
  - "[code://packages/model-openai-compat/src/index.ts#L27-L50](../../packages/model-openai-compat/src/index.ts#L27-L50) - every request takes its headers from `headersFor`, and none of them is a User-Agent"
  - "[code://packages/model-openai-compat/src/types/options.ts#L3-L17](../../packages/model-openai-compat/src/types/options.ts#L3-L17) - `OpenAICompatProviderOptions`, where a provider's `headers` are"
  - "[code://packages/model-openai-compat/src/config.ts#L7-L30](../../packages/model-openai-compat/src/config.ts#L7-L30) - a provider in a config file takes `headers`, and `providersOf` passes them on"
  - "[code://packages/papo/src/commands.ts#L134](../../packages/papo/src/commands.ts#L134) - papo builds its providers with `providersOf`"
  - https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-cofold/src/agent.ts#L720-L733 - agent-cofold builds its providers with `openaiCompatProvider`
  - https://openrouter.ai/docs/app-attribution - OpenRouter's app attribution, read 2026-11-09
---

# A model call names the app that makes it

Softov wants every model call from cofold to say which app makes it, so that OpenRouter attributes the usage to that app. The name is `cofold` by default, `copapo` in copapo and `ahpd` in ahpd, and a program can change it.

## What others do

OpenRouter does not read User-Agent for attribution. It reads two headers ([app attribution](https://openrouter.ai/docs/app-attribution)):

- `HTTP-Referer` is required. It is a URL. Without it, OpenRouter makes no app page and the usage is not in the rankings.
- `X-OpenRouter-Title` is the name that OpenRouter shows. It has no effect without `HTTP-Referer`. `X-Title` is the old name of the same header, and OpenRouter still reads it.

## What cofold has today

- Every request of `openaiCompatProvider` goes through `attempt`, which takes its headers from `headersFor` ([index.ts](../../packages/model-openai-compat/src/index.ts#L27-L50)). The headers are `content-type`, the provider's own `headers` and `authorization`. No User-Agent is set, so Node sends its own, `node`.
- A provider takes `headers` in its options ([options.ts](../../packages/model-openai-compat/src/types/options.ts#L3-L17)) and in a config file ([config.ts](../../packages/model-openai-compat/src/config.ts#L7-L30)). A person can set the OpenRouter headers there today, by hand, for each provider.
- papo builds its providers with `providersOf` ([commands.ts](../../packages/papo/src/commands.ts#L134)).
- `@cofold/agents` makes no HTTP call. The change is in `@cofold/model-openai-compat`.
- The claude backend calls Anthropic through the Claude Code CLI, not through this adapter. This change does not reach it.
- The web tools set their own headers. They are out of this change.

## What ahpd has today

- agent-cofold builds each provider with `openaiCompatProvider` and passes `name`, `baseUrl`, `apiKey` and `headers` ([agent.ts](https://github.com/softov/ahpd/blob/cb74ca9c2/packages/agent-cofold/src/agent.ts#L720-L733)). It does not use `providersOf`.

## Who writes

- cofold `main` is the only branch with work. No fork.
- The copapo brief ([copapo-and-acp.md](copapo-and-acp.md)) renames papo. If the rename lands first, copapo passes its name from `packages/copapo`. The two briefs touch different files otherwise.
- ahpd passes its name after a cofold release, in its own plan. ahpd's tests run against the cofold release candidate first.

## The change

Answers from Softov, 2026-11-09:

| Question | Answer |
| --- | --- |
| Which headers? | User-Agent, `HTTP-Referer` and `X-OpenRouter-Title`. |
| What is the title? | The app's name. |
| Which URL goes in `HTTP-Referer`? | `https://github.com/softov/cofold` for cofold and copapo. `https://ahpio.com` for ahpd. |
| Which providers get `HTTP-Referer` and `X-OpenRouter-Title`? | Only a provider whose base URL is on `openrouter.ai`. Every provider gets User-Agent. |
| Do the web tools change? | No. |

- `openaiCompatProvider` takes an `app` option: a `name`, a `version` and a `url`.
- With no `app`, the name is `cofold`, the version is the adapter's own, and the URL is `https://github.com/softov/cofold`.
- Every request sends `User-Agent: <name>/<version>`.
- A request to a base URL on `openrouter.ai` also sends `HTTP-Referer: <url>` and `X-OpenRouter-Title: <name>`.
- The provider's own `headers` win over all three, so a person still sets them by hand in the config file.
- `providersOf` takes the same `app` and gives it to each provider.
- copapo passes `{ name: 'copapo', version: <copapo's version>, url: 'https://github.com/softov/cofold' }`.
- agent-cofold passes `{ name: 'ahpd', version: <ahpd's version>, url: 'https://ahpio.com' }`, in ahpd's own plan.
- The title header is `X-OpenRouter-Title`, the current name. The change does not send the old `X-Title`.
